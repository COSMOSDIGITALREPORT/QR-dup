const readline = require('readline');
const path = require('path');

// Ensure we load .env from the server directory
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');
const Admin = require('./models/Admin');

// Ensure terminal mode is restored even on unexpected crashes or interrupts
const restoreTerminal = () => {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    try {
      process.stdin.setRawMode(false);
    } catch (_) {}
  }
};

process.on('exit', restoreTerminal);
process.on('SIGINT', () => {
  restoreTerminal();
  process.exit(130);
});
process.on('uncaughtException', (err) => {
  restoreTerminal();
  console.error('\n❌ Uncaught error:', err.message);
  process.exit(1);
});

function askHidden(query) {
  return new Promise((resolve, reject) => {
    process.stdout.write(query);

    // Non-interactive / piped input fallback
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      rl.question('', (ans) => {
        rl.close();
        resolve(ans.trim());
      });
      return;
    }

    let password = '';
    const wasRaw = Boolean(process.stdin.isRaw);

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      try {
        process.stdin.setRawMode(wasRaw);
      } catch (_) {}
      process.stdin.pause();
    };

    const onData = (buffer) => {
      const str = buffer.toString('utf8');
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '\u0003') { // Ctrl+C
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        } else if (char === '\u0004') { // Ctrl+D (EOF)
          cleanup();
          process.stdout.write('\n');
          process.exit(0);
        } else if (char === '\r' || char === '\n') { // Enter
          cleanup();
          process.stdout.write('\n');
          resolve(password);
          return;
        } else if (char === '\u0008' || char === '\x7f') { // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char === '\x1b') {
          // Skip ANSI escape sequences (arrows, home, end, etc.)
          if (i + 1 < str.length && str[i + 1] === '[') {
            i += 1;
            while (i + 1 < str.length && (str.charCodeAt(i + 1) >= 0x30 && str.charCodeAt(i + 1) <= 0x3f)) {
              i += 1;
            }
            if (i + 1 < str.length) {
              i += 1;
            }
          }
          continue;
        } else if (char >= ' ' && char !== '\x7f') {
          password += char;
          process.stdout.write('*');
        }
      }
    };

    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

function askPlain(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ Error: MONGO_URI is missing in server/.env');
    process.exit(1);
  }

  // Safety confirmation: target DB must be weighingqr_new
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
  if (dbName !== 'weighingqr_new') {
    console.error(`❌ Safety check failed: Target database is not weighingqr_new (found: "${dbName}"). Aborting.`);
    process.exit(1);
  }

  console.log('========================================================');
  console.log('       SAFE SUPERADMIN CREATION - LOCAL BOOTSTRAP       ');
  console.log('========================================================');
  console.log(`Target Cluster  : ${parsed.host}`);
  console.log(`Target Database : weighingqr_new`);
  console.log(`Admin Email     : superadmin@induscore.com`);
  console.log(`Role            : superadmin`);
  console.log('--------------------------------------------------------');

  // Connect to DB
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(uri);
  console.log('✅ Connected successfully.\n');

  // Verify target admin doesn't already exist
  const existing = await Admin.findOne({ email: 'superadmin@induscore.com' });
  if (existing) {
    console.log('⚠️  Notice: An admin with email superadmin@induscore.com already exists in weighingqr_new.');
    console.log('No changes were made.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Prompt for custom password securely
  const pass1 = await askHidden('Enter new password for SuperAdmin (min 6 chars): ');
  if (!pass1 || pass1.length < 6) {
    console.error('❌ Password must be at least 6 characters long. Aborting.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const pass2 = await askHidden('Confirm new password: ');
  if (pass1 !== pass2) {
    console.error('❌ Passwords do not match. Aborting.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\nReady to create account:');
  console.log('  Email : superadmin@induscore.com');
  console.log('  Role  : superadmin');
  console.log('  Status: Active');

  const confirm = await askPlain('\nConfirm creation? Type "yes" to proceed: ');
  if (confirm.toLowerCase() !== 'yes') {
    console.log('Cancelled by user. No records were created.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Create only this SuperAdmin
  const admin = await Admin.create({
    name: 'Super Admin',
    email: 'superadmin@induscore.com',
    password: pass1,
    role: 'superadmin',
    isActive: true,
  });

  console.log('\n🎉 SUCCESS: SuperAdmin account created successfully!');
  console.log(`ID: ${admin._id}`);
  console.log('You can now log in at https://dqr-v2.vercel.app with:');
  console.log('  Email: superadmin@induscore.com');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  restoreTerminal();
  console.error('\n❌ Error during SuperAdmin creation:', err.message);
  process.exit(1);
});
