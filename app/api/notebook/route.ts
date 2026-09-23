import { storage } from "@/db/storage";
import { getAuthenticatedUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

type TiptapNode = {
  type: string;
  text?: string;
  marks?: unknown[];
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
};
type BlockInput = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  content?: unknown;
};

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const now = () => new Date().toISOString();
const validBlockTypes = new Set([
  "concept",
  "example",
  "warning",
  "formula",
  "definition",
  "attention",
  "comparison",
  "section",
]);
const validNodeTypes = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "blockquote",
  "codeBlock",
  "heading",
]);
const validMarkTypes = new Set(["bold", "italic", "highlight", "code"]);

function documentIsSafe(value: unknown): value is TiptapNode {
  const visit = (node: unknown, isRoot = false): node is TiptapNode => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const candidate = node as TiptapNode;
    if (
      typeof candidate.type !== "string" ||
      !validNodeTypes.has(candidate.type) ||
      (isRoot && candidate.type !== "doc")
    )
      return false;
    if (candidate.type === "text" && typeof candidate.text !== "string")
      return false;
    if (candidate.text && candidate.text.length > 500_000) return false;
    if (
      candidate.marks &&
      (!Array.isArray(candidate.marks) ||
        candidate.marks.some(
          (mark) =>
            !mark ||
            typeof mark !== "object" ||
            !validMarkTypes.has((mark as { type?: unknown }).type as string),
        ))
    )
      return false;
    if (
      candidate.attrs &&
      Object.entries(candidate.attrs).some(
        ([key, item]) =>
          !["colspan", "rowspan", "colwidth", "level", "start"].includes(key) ||
          (typeof item !== "number" && !Array.isArray(item)),
      )
    )
      return false;
    return (
      !candidate.content ||
      (Array.isArray(candidate.content) &&
        candidate.content.every((child) => visit(child)))
    );
  };
  return visit(value, true);
}

function textFromDocument(node: TiptapNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const value = (node.content || [])
    .map(textFromDocument)
    .join(node.type === "hardBreak" ? "\n" : "");
  return [
    "paragraph",
    "listItem",
    "tableRow",
    "heading",
    "blockquote",
    "codeBlock",
  ].includes(node.type)
    ? `${value}\n`
    : value;
}

function parseBlocks(value: unknown): {
  blocks: Required<Pick<BlockInput, "id" | "type" | "title" | "content">>[];
  plainText: string;
} | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const blocks: Required<
    Pick<BlockInput, "id" | "type" | "title" | "content">
  >[] = [];
  let plainText = "";
  for (const block of value as BlockInput[]) {
    const id =
      typeof block.id === "string" && block.id ? block.id : crypto.randomUUID();
    const type = typeof block.type === "string" ? block.type : "";
    const title = typeof block.title === "string" ? block.title.trim() : "";
    if (
      !validBlockTypes.has(type) ||
      title.length > 180 ||
      !documentIsSafe(block.content)
    )
      return null;
    blocks.push({ id, type, title, content: block.content });
    plainText += `${title}\n${textFromDocument(block.content).trim()}\n\n`;
  }
  return { blocks, plainText: plainText.trim().slice(0, 500_000) };
}

async function authenticated(request: Request) {
  const userId = await getAuthenticatedUserId(request);
  return userId || null;
}

export async function GET(request: Request) {
  const userId = await authenticated(request);
  if (!userId)
    return json({ error: "Entre com sua conta para acessar o caderno." }, 401);
  try {
    const { db, bucket } = storage();
    const url = new URL(request.url);
    const fileId = url.searchParams.get("file");
    if (fileId) {
      const file = await db
        .prepare(
          "SELECT id, filename, mime_type, storage_key FROM attachments WHERE id=? AND user_id=?",
        )
        .bind(fileId, userId)
        .first<{
          id: string;
          filename: string;
          mime_type: string;
          storage_key: string;
        }>();
      if (!file) return json({ error: "Arquivo não encontrado." }, 404);
      const object = await bucket.get(file.storage_key);
      if (!object) return json({ error: "Arquivo indisponível." }, 404);
      return new Response(object.body, {
        headers: {
          "Content-Type": file.mime_type || "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }
    const [subjectRows, noteRows, blockRows, fileRows, examRows] =
      await Promise.all([
        db
          .prepare(
            "SELECT id, name, color FROM subjects WHERE user_id=? ORDER BY created_at",
          )
          .bind(userId)
          .all<{ id: string; name: string; color: string }>(),
        db
          .prepare(
            "SELECT id, subject_id, title, summary, plain_text, updated_at FROM notes WHERE user_id=? ORDER BY updated_at DESC",
          )
          .bind(userId)
          .all<{
            id: string;
            subject_id: string;
            title: string;
            summary: string;
            plain_text: string;
            updated_at: string;
          }>(),
        db
          .prepare(
            "SELECT id, note_id, position, type, title, content FROM note_blocks WHERE note_id IN (SELECT id FROM notes WHERE user_id=?) ORDER BY note_id, position",
          )
          .bind(userId)
          .all<{
            id: string;
            note_id: string;
            position: number;
            type: string;
            title: string;
            content: string;
          }>(),
        db
          .prepare(
            "SELECT id, note_id, filename, size, mime_type FROM attachments WHERE user_id=?",
          )
          .bind(userId)
          .all<{
            id: string;
            note_id: string;
            filename: string;
            size: number;
            mime_type: string;
          }>(),
        db
          .prepare(
            "SELECT id, subject_id, title, date, time, content FROM exams WHERE user_id=? ORDER BY date, time",
          )
          .bind(userId)
          .all<{
            id: string;
            subject_id: string;
            title: string;
            date: string;
            time: string | null;
            content: string;
          }>(),
      ]);
    const blocksByNote = new Map<string, unknown[]>();
    for (const block of blockRows.results) {
      const blocks = blocksByNote.get(block.note_id) || [];
      try {
        blocks.push({
          id: block.id,
          type: block.type,
          title: block.title,
          content: JSON.parse(block.content),
        });
      } catch {
        /* Corrupt blocks are omitted rather than rendered as HTML. */
      }
      blocksByNote.set(block.note_id, blocks);
    }
    return json({
      subjects: subjectRows.results,
      notes: noteRows.results.map((note) => ({
        id: note.id,
        subject: note.subject_id,
        title: note.title,
        summary: note.summary,
        body: note.plain_text,
        blocks: JSON.stringify(blocksByNote.get(note.id) || []),
        updated: note.updated_at,
      })),
      files: fileRows.results.map((file) => ({
        id: file.id,
        note: file.note_id,
        name: file.filename,
        size: file.size,
        mimeType: file.mime_type,
      })),
      exams: examRows.results.map((exam) => ({
        id: exam.id,
        subject: exam.subject_id,
        title: exam.title,
        date: exam.date,
        time: exam.time || "",
        content: exam.content,
      })),
    });
  } catch (error) {
    console.error("Notebook load error", error);
    return json({ error: "Não foi possível abrir seu caderno." }, 503);
  }
}

export async function POST(request: Request) {
  const userId = await authenticated(request);
  if (!userId)
    return json({ error: "Entre com sua conta para acessar o caderno." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Origem inválida." }, 403);
  try {
    const { db, bucket } = storage();
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > 22 * 1024 * 1024)
        return json({ error: "Limite de 20 MB por arquivo." }, 413);
      const data = await request.formData();
      const file = data.get("file");
      const noteId = data.get("note");
      if (
        !(file instanceof File) ||
        typeof noteId !== "string" ||
        !file.size ||
        file.size > 20 * 1024 * 1024
      )
        return json({ error: "Envie um arquivo de até 20 MB." }, 400);
      if (
        !(await db
          .prepare("SELECT id FROM notes WHERE id=? AND user_id=?")
          .bind(noteId, userId)
          .first())
      )
        return json({ error: "Página não encontrada." }, 404);
      const id = crypto.randomUUID();
      const storageKey = `${userId}/${id}`;
      await bucket.put(storageKey, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });
      try {
        await db
          .prepare(
            "INSERT INTO attachments (id,user_id,note_id,filename,mime_type,size,storage_key) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            userId,
            noteId,
            file.name.slice(0, 255),
            file.type || "application/octet-stream",
            file.size,
            storageKey,
          )
          .run();
      } catch (error) {
        await bucket.delete(storageKey);
        throw error;
      }
      return json({
        id,
        note: noteId,
        name: file.name.slice(0, 255),
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (body.action === "subject") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const color = typeof body.color === "string" ? body.color : "";
      if (!name || name.length > 100 || !/^#[0-9a-f]{6}$/i.test(color))
        return json({ error: "Confira o nome e a cor da matéria." }, 400);
      if (id) {
        await db
          .prepare(
            "UPDATE subjects SET name=?, color=? WHERE id=? AND user_id=?",
          )
          .bind(name, color, id, userId)
          .run();
        return json({ id });
      }
      const subjectId = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO subjects (id,user_id,name,color,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(subjectId, userId, name, color, now())
        .run();
      return json({ id: subjectId });
    }
    if (body.action === "note") {
      const subjectId = typeof body.subject === "string" ? body.subject : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const summary = typeof body.summary === "string" ? body.summary : "";
      const parsed = parseBlocks(body.blocks);
      if (
        !title ||
        title.length > 200 ||
        summary.length > 12_000 ||
        !parsed ||
        JSON.stringify(parsed.blocks).length > 500_000
      )
        return json({ error: "Confira o título e o conteúdo da página." }, 400);
      if (
        !(await db
          .prepare("SELECT id FROM subjects WHERE id=? AND user_id=?")
          .bind(subjectId, userId)
          .first())
      )
        return json({ error: "Matéria não encontrada." }, 404);
      const timestamp = now();
      const noteId = id || crypto.randomUUID();
      if (id) {
        const result = await db
          .prepare(
            "UPDATE notes SET subject_id=?,title=?,summary=?,plain_text=?,updated_at=? WHERE id=? AND user_id=?",
          )
          .bind(
            subjectId,
            title,
            summary,
            parsed.plainText,
            timestamp,
            noteId,
            userId,
          )
          .run();
        if (!result.meta.changes)
          return json({ error: "Página não encontrada." }, 404);
        await db
          .prepare("DELETE FROM note_blocks WHERE note_id=?")
          .bind(noteId)
          .run();
      } else {
        await db
          .prepare(
            "INSERT INTO notes (id,user_id,subject_id,title,summary,plain_text,legacy_blocks,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            noteId,
            userId,
            subjectId,
            title,
            summary,
            parsed.plainText,
            "",
            timestamp,
            timestamp,
          )
          .run();
      }
      if (parsed.blocks.length)
        await db.batch(
          parsed.blocks.map((block, position) =>
            db
              .prepare(
                "INSERT INTO note_blocks (id,note_id,position,type,title,content) VALUES (?,?,?,?,?,?)",
              )
              .bind(
                block.id,
                noteId,
                position,
                block.type,
                block.title,
                JSON.stringify(block.content),
              ),
          ),
        );
      return json({ id: noteId, updated: timestamp });
    }
    if (body.action === "exam") {
      const subjectId = typeof body.subject === "string" ? body.subject : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const date = typeof body.date === "string" ? body.date : "";
      const time = typeof body.time === "string" ? body.time : "";
      const content = typeof body.content === "string" ? body.content : "";
      if (
        !title ||
        title.length > 200 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
        content.length > 500_000
      )
        return json(
          { error: "Preencha nome, matéria, data e horário da prova." },
          400,
        );
      if (
        !(await db
          .prepare("SELECT id FROM subjects WHERE id=? AND user_id=?")
          .bind(subjectId, userId)
          .first())
      )
        return json({ error: "Matéria não encontrada." }, 404);
      const timestamp = now();
      if (id) {
        const result = await db
          .prepare(
            "UPDATE exams SET subject_id=?,title=?,date=?,time=?,content=?,updated_at=? WHERE id=? AND user_id=?",
          )
          .bind(subjectId, title, date, time, content, timestamp, id, userId)
          .run();
        if (!result.meta.changes)
          return json({ error: "Prova não encontrada." }, 404);
        return json({ id });
      }
      const examId = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO exams (id,user_id,subject_id,title,date,time,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          examId,
          userId,
          subjectId,
          title,
          date,
          time,
          content,
          timestamp,
          timestamp,
        )
        .run();
      return json({ id: examId });
    }
    if (body.action === "delete-file") {
      const file = await db
        .prepare("SELECT storage_key FROM attachments WHERE id=? AND user_id=?")
        .bind(id, userId)
        .first<{ storage_key: string }>();
      if (file) {
        await bucket.delete(file.storage_key);
        await db
          .prepare("DELETE FROM attachments WHERE id=? AND user_id=?")
          .bind(id, userId)
          .run();
      }
      return json({ ok: true });
    }
    if (body.action === "delete-note") {
      const files = await db
        .prepare(
          "SELECT storage_key FROM attachments WHERE note_id=? AND user_id=?",
        )
        .bind(id, userId)
        .all<{ storage_key: string }>();
      for (const file of files.results) await bucket.delete(file.storage_key);
      await db
        .prepare("DELETE FROM notes WHERE id=? AND user_id=?")
        .bind(id, userId)
        .run();
      return json({ ok: true });
    }
    if (body.action === "delete-subject") {
      const files = await db
        .prepare(
          "SELECT storage_key FROM attachments WHERE user_id=? AND note_id IN (SELECT id FROM notes WHERE subject_id=? AND user_id=?)",
        )
        .bind(userId, id, userId)
        .all<{ storage_key: string }>();
      for (const file of files.results) await bucket.delete(file.storage_key);
      await db
        .prepare("DELETE FROM exams WHERE subject_id=? AND user_id=?")
        .bind(id, userId)
        .run();
      await db
        .prepare("DELETE FROM subjects WHERE id=? AND user_id=?")
        .bind(id, userId)
        .run();
      return json({ ok: true });
    }
    if (body.action === "delete-exam") {
      await db
        .prepare("DELETE FROM exams WHERE id=? AND user_id=?")
        .bind(id, userId)
        .run();
      return json({ ok: true });
    }
    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("Notebook storage error", error);
    return json(
      {
        error:
          "Não foi possível concluir. Seu texto continua na tela; tente novamente.",
      },
      503,
    );
  }
}
