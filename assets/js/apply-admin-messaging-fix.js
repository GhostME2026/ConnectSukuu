#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Run this script from the connectsukuu-frontend folder, or place it there.
const target = path.join(__dirname, '/assets/js/role-workspace.js');
if (!fs.existsSync(target)) {
  console.error('Cannot find /assets/js/role-workspace.js beside this script. Extract this ZIP into connectsukuu-frontend and run it there.');
  process.exit(1);
}
const original = fs.readFileSync(target, 'utf8');
const old = 'const rows=related(c.id);thread.innerHTML=rows.length?rows.map(m=>{const outgoing=m.senderId===user()?.id;return `<article class="cs-chat-bubble ${outgoing?\'outgoing\':\'\'}">';
const replacement = 'const rows=related(c.id);thread.innerHTML=rows.length?rows.map(m=>{const outgoing=isOutgoingMessage(m);return `<article class="cs-chat-bubble ${outgoing?\'outgoing\':\'\'}">';
if (original.includes('const outgoing=isOutgoingMessage(m)') && original.includes('function isOutgoingMessage(m)')) {
  console.log('Messaging alignment repair is already applied; no changes made.');
  process.exit(0);
}
if (original.split(old).length !== 2) {
  console.error('Expected messaging renderer was not found exactly once. No files changed.');
  process.exit(1);
}
const helper = ` function isOutgoingMessage(m){\n  const current=user()||{};\n  const currentId=String(current.id||'');\n  const currentRole=String(document.body.dataset.role||current.role||'').toUpperCase();\n  const senderId=String(m.senderId||m.sender?.id||'');\n  const recipientId=String(m.recipientId||m.recipient?.id||'');\n  const senderRole=String(m.sender?.role||'').toUpperCase();\n  // Recipient identity takes precedence: a message addressed to this account is incoming.\n  if(currentId && recipientId===currentId)return false;\n  // Use both account ID and role to avoid misclassifying a colleague's message.\n  if(currentId && senderId===currentId)return !senderRole||!currentRole||senderRole===currentRole;\n  if(senderRole&&currentRole)return senderRole===currentRole;\n  return false;\n }\n`;
const anchor = " function related(id){return messages.filter(m=>(m.senderId===id&&m.recipientId===user()?.id)||(m.recipientId===id&&m.senderId===user()?.id)).sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0))}\n";
if (original.split(anchor).length !== 2) {
  console.error('Expected conversation helper was not found exactly once. No files changed.');
  process.exit(1);
}
let patched = original.replace(old, replacement).replace(anchor, anchor + helper);
const temp = target + '.admin-message-fix.tmp.js';
fs.writeFileSync(temp, patched, 'utf8');
const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
if (check.status !== 0) {
  fs.rmSync(temp, { force: true });
  console.error('JavaScript syntax validation failed. Original file was not changed.\n' + (check.stderr || check.stdout));
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = target + '.before-admin-message-fix-' + stamp;
fs.copyFileSync(target, backup);
fs.renameSync(temp, target);
console.log('Administrator messaging alignment repair applied.');
console.log('Backup: ' + backup);
console.log('Validation: node --check passed.');
console.log('Only /assets/js/role-workspace.js was changed; no backend, database, billing, or other role files were changed.');
