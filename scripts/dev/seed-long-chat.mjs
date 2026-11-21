// Dev helper: seeds a 3000-message chat for performance testing. Usage: node scripts/dev/seed-long-chat.mjs
import postgres from "postgres";
const sql = postgres("postgres://tavern:tavern@localhost:5432/tavern", { onnotice: () => {} });
const [c] = await sql`select id from characters order by created_at limit 1`;
const [p] = await sql`select id from personas order by sort limit 1`;
const [chat] = await sql`insert into chats (character_id, title, persona_id) values (${c.id}, 'Perf test (3000 msgs)', ${p.id}) returning id`;
const N = 3000;
const ids = Array.from({ length: N }, () => crypto.randomUUID());
const rows = ids.map((id, i) => ({
  id, chat_id: chat.id, parent_id: i ? ids[i - 1] : null, active_child_id: i < N - 1 ? ids[i + 1] : null,
  role: i % 2 ? "user" : "assistant", persona_id: i % 2 ? p.id : null, character_id: i % 2 ? null : c.id,
  content: i % 2 ? `Message ${i}: tell me more about the road ahead.` : `*Mira considers this.* "Message ${i}. ${"The storm keeps howling outside. ".repeat(1 + (i % 6))}"`,
  status: "complete", created_at: new Date(Date.now() - (N - i) * 60000), updated_at: new Date(Date.now() - (N - i) * 60000),
}));
for (let i = 0; i < rows.length; i += 500) await sql`insert into messages ${sql(rows.slice(i, i + 500))}`;
await sql`update chats set active_root_id = ${ids[0]}, last_message_at = now() - interval '1 day' where id = ${chat.id}`;
console.log(chat.id);
await sql.end();
