import { hash } from "@node-rs/argon2";

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: pnpm auth:hash "your password"');
  process.exit(1);
}
hash(pw).then((h) => {
  // Argon2 hashes contain "$", which Next.js expands as variables in .env files *and* in the
  // process environment (e.g. Docker). Base64 avoids the problem entirely.
  console.log("\nAdd this line to .env.local (or your Docker environment):\n");
  console.log(`AUTH_PASSWORD_HASH=b64:${Buffer.from(h, "utf8").toString("base64")}\n`);
});
