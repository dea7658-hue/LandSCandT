import { validateItem } from "./validation";
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PHOTOS: R2Bucket;
}
const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
export default {
  async fetch(r: Request, e: Env): Promise<Response> {
    const u = new URL(r.url);
    if (!u.pathname.startsWith("/api/")) return e.ASSETS.fetch(r);
    try {
      if (r.headers.get("origin") && r.headers.get("origin") !== u.origin)
        return json({ error: "허용되지 않은 출처" }, 403);
      if (!["GET", "POST", "PUT", "DELETE"].includes(r.method))
        return json({ error: "지원하지 않는 메서드" }, 405);
      if (u.pathname === "/api/health" && r.method === "GET") {
        try {
          await e.DB.prepare("SELECT id FROM projects LIMIT 1").first();
          await e.DB.prepare("SELECT id FROM photos LIMIT 1").first();
          await e.PHOTOS.head("__moa_healthcheck__");
          return json({ ok: true, database: true, photos: true });
        } catch {
          return json(
            {
              ok: false,
              message: "저장소 또는 DB 마이그레이션 설정을 확인해주세요.",
            },
            503,
          );
        }
      }
      let b: any = {};
      if (r.method !== "GET" && u.pathname !== "/api/photos") {
        const raw = await r.text();
        if (raw.length > 20000)
          return json({ error: "요청이 너무 큽니다" }, 413);
        b = raw ? JSON.parse(raw) : {};
      }
      if (
        r.method === "POST" &&
        ["/api/create", "/api/join"].includes(u.pathname)
      ) {
        const now = Date.now(),
          key =
            (r.headers.get("CF-Connecting-IP") || "local") +
            ":" +
            Math.floor(now / 60000);
        await e.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?")
          .bind(now)
          .run();
        const rate = await e.DB.prepare(
          "INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
        )
          .bind(key, now + 120000)
          .first<{ count: number }>();
        if ((rate?.count || 0) > 12)
          return json(
            { error: "요청이 많습니다. 잠시 후 다시 시도하세요." },
            429,
          );
        const nickname = String(b.nickname || "친구")
          .trim()
          .slice(0, 30);
        let project: any, code: string | undefined, admin: string | undefined;
        if (u.pathname === "/api/create") {
          const name = String(b.name || "").trim();
          if (!name || name.length > 100)
            return json({ error: "프로젝트 이름은 1~100자입니다" }, 400);
          code = token().slice(0, 24);
          admin = token();
          project = { id: crypto.randomUUID(), name };
          await e.DB.prepare("INSERT INTO projects VALUES (?,?,?,?,?)")
            .bind(project.id, name, await hash(code), await hash(admin), now)
            .run();
        } else {
          project = await e.DB.prepare(
            "SELECT id,name FROM projects WHERE code_hash=?",
          )
            .bind(
              await hash(
                String(b.code || "")
                  .trim()
                  .toLowerCase(),
              ),
            )
            .first();
          if (!project) return json({ error: "코드를 확인해주세요" }, 403);
        }
        const session = token();
        await e.DB.prepare("INSERT INTO sessions VALUES (?,?,?,?)")
          .bind(await hash(session), project.id, nickname, now + 30 * 86400000)
          .run();
        return json({ project, token: session, nickname, code, admin });
      }
      const auth =
        r.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
      const session = await e.DB.prepare(
        "SELECT project_id,nickname FROM sessions WHERE token_hash=? AND expires_at>?",
      )
        .bind(await hash(auth), Date.now())
        .first<{ project_id: string; nickname: string }>();
      if (!session)
        return json({ error: "참여 코드로 다시 입장해주세요" }, 401);
      const pid = session.project_id;

      if (u.pathname === "/api/photos" && ["GET", "POST"].includes(r.method)) {
        const item = u.searchParams.get("item");
        const exists = await e.DB.prepare(
          "SELECT id FROM items WHERE id=? AND project_id=? AND deleted=0",
        )
          .bind(item, pid)
          .first();
        if (!exists) return json({ error: "장소를 먼저 저장해주세요" }, 404);
        if (r.method === "GET") {
          const result = await e.DB.prepare(
            "SELECT id,size,nickname,created_at FROM photos WHERE project_id=? AND item_id=? ORDER BY created_at DESC",
          )
            .bind(pid, item)
            .all();
          return json({ photos: result.results });
        }
        const count = await e.DB.prepare(
          "SELECT COUNT(*) as n FROM photos WHERE project_id=?",
        )
          .bind(pid)
          .first<{ n: number }>();
        if ((count?.n || 0) >= 200)
          return json({ error: "프로젝트당 사진은 최대 200장입니다" }, 413);
        if (r.headers.get("Content-Type") !== "image/webp")
          return json({ error: "WebP 사진만 지원합니다" }, 400);
        const reader = r.body?.getReader();
        if (!reader) return json({ error: "사진이 없습니다" }, 400);
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2000000) {
            await reader.cancel();
            return json({ error: "사진은 2MB 이하입니다" }, 413);
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        if (
          size < 12 ||
          new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" ||
          new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP"
        )
          return json({ error: "사진 형식이 올바르지 않습니다" }, 400);
        const id = crypto.randomUUID(),
          key = pid + "/" + id;
        await e.PHOTOS.put(key, bytes, {
          httpMetadata: { contentType: "image/webp" },
        });
        try {
          await e.DB.prepare("INSERT INTO photos VALUES (?,?,?,?,?,?)")
            .bind(id, pid, item, size, session.nickname, Date.now())
            .run();
        } catch (err) {
          await e.PHOTOS.delete(key);
          throw err;
        }
        return json({ id });
      }
      const photoMatch = u.pathname.match(/^\/api\/photos\/([a-f0-9-]{36})$/);
      if (photoMatch && ["GET", "DELETE"].includes(r.method)) {
        const photo = await e.DB.prepare(
          "SELECT p.id FROM photos p JOIN items i ON i.id=p.item_id WHERE p.id=? AND p.project_id=? AND i.deleted=0",
        )
          .bind(photoMatch[1], pid)
          .first();
        if (!photo) return json({ error: "사진을 찾을 수 없습니다" }, 404);
        const key = pid + "/" + photoMatch[1];
        if (r.method === "DELETE") {
          await e.PHOTOS.delete(key);
          await e.DB.prepare("DELETE FROM photos WHERE id=? AND project_id=?")
            .bind(photoMatch[1], pid)
            .run();
          return json({ ok: true });
        }
        const object = await e.PHOTOS.get(key);
        if (!object) return json({ error: "사진을 찾을 수 없습니다" }, 404);
        return new Response(object.body, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (u.pathname === "/api/items" && r.method === "GET") {
        const since = Number(u.searchParams.get("since") || 0);
        if (!Number.isSafeInteger(since) || since < 0)
          return json({ error: "잘못된 커서" }, 400);
        const rows = await e.DB.prepare(
          "SELECT seq,id,version,deleted,data FROM items WHERE project_id=? AND seq>? ORDER BY seq LIMIT 500",
        )
          .bind(pid, since)
          .all<any>();
        return json({
          items: rows.results.map((x) => ({
            ...JSON.parse(x.data),
            id: x.id,
            version: x.version,
            deleted: !!x.deleted,
          })),
          cursor: rows.results.at(-1)?.seq || since,
          more: rows.results.length === 500,
        });
      }
      const match = u.pathname.match(/^\/api\/items\/([a-f0-9-]{36})$/);
      if (match && r.method === "PUT") {
        const id = match[1],
          data = validateItem(b.item);
        if (!Number.isSafeInteger(b.version) || b.version < 0)
          return json({ error: "버전 오류" }, 400);
        const encoded = JSON.stringify({
          ...data,
          updatedBy: session.nickname,
        });
        let result;
        if (b.version === 0)
          result = await e.DB.prepare(
            "INSERT OR IGNORE INTO items(id,project_id,version,deleted,data) VALUES (?,?,1,?,?)",
          )
            .bind(id, pid, b.deleted ? 1 : 0, encoded)
            .run();
        else
          result = await e.DB.prepare(
            "UPDATE items SET seq=(SELECT COALESCE(MAX(seq),0)+1 FROM items), version=version+1,deleted=?,data=? WHERE id=? AND project_id=? AND version=?",
          )
            .bind(b.deleted ? 1 : 0, encoded, id, pid, b.version)
            .run();
        if (!result.meta.changes)
          return json(
            {
              error: "다른 친구가 수정했습니다. 새로고침 후 다시 확인해주세요.",
            },
            409,
          );
        return json({ version: b.version + 1 });
      }
      if (u.pathname === "/api/admin" && r.method === "POST") {
        const project = await e.DB.prepare(
          "SELECT id FROM projects WHERE id=? AND admin_hash=?",
        )
          .bind(pid, await hash(String(b.admin || "")))
          .first();
        if (!project)
          return json({ error: "관리 키가 올바르지 않습니다" }, 403);
        if (b.action === "rotate") {
          const code = token().slice(0, 24);
          await e.DB.batch([
            e.DB.prepare("UPDATE projects SET code_hash=? WHERE id=?").bind(
              await hash(code),
              pid,
            ),
            e.DB.prepare(
              "DELETE FROM sessions WHERE project_id=? AND token_hash<>?",
            ).bind(pid, await hash(auth)),
          ]);
          return json({ code });
        }
        if (b.action === "delete") {
          const all = await e.DB.prepare(
            "SELECT id FROM photos WHERE project_id=?",
          )
            .bind(pid)
            .all<{ id: string }>();
          if (all.results.length)
            await e.PHOTOS.delete(all.results.map((p) => pid + "/" + p.id));
          await e.DB.prepare("DELETE FROM photos WHERE project_id=?")
            .bind(pid)
            .run();
          await e.DB.batch([
            e.DB.prepare("DELETE FROM items WHERE project_id=?").bind(pid),
            e.DB.prepare("DELETE FROM sessions WHERE project_id=?").bind(pid),
            e.DB.prepare("DELETE FROM projects WHERE id=?").bind(pid),
          ]);
          return json({ ok: true });
        }
      }
      return json({ error: "요청을 찾을 수 없습니다" }, 404);
    } catch (err) {
      console.error(err);
      return json(
        {
          error:
            err instanceof Error && !/D1|SQL|database/i.test(err.message)
              ? err.message
              : "서버 처리 오류",
        },
        400,
      );
    }
  },
};
