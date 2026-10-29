// Run this ONCE to create your own platform-admin login:
//   node scripts/create-super-admin.js you@example.com "a-real-password" "Your Name"
//
// There's no signup form for SUPER_ADMIN on purpose — it's you, not a school,
// so it doesn't belong on a public signup page.

const bcrypt = require('bcryptjs');
const prisma = require('../src/config/db');

async function main() {
  const [, , email, password, name] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/create-super-admin.js <email> <password> [name]');
    process.exit(1);
  }

  const [firstName, ...rest] = (name || 'Admin User').split(' ');
  const lastName = rest.join(' ') || 'Admin';

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, passwordHash, firstName, lastName, role: 'SUPER_ADMIN' },
  });

  console.log('Super admin created:', user.email);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
