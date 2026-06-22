import fs from 'node:fs';
import { verifyPassword } from './src/lib/password.ts';

const envContent = fs.readFileSync('.env.local', 'utf8');
const pepperMatch = envContent.match(/^PASSWORD_PEPPER=(.+)$/m);
const pepper = pepperMatch ? pepperMatch[1] : '';
console.log('PEPPER len:', pepper.length);

const seedPw = 'JOurNameList21';
const seedHash = 'f6cc44c20862b8d4febb6200ebbb72bd529cb3acbbe99d893da5770ae3ce4e4a';
const seedSalt = 'aa4027bb393ac1163d120a3dd2ad020d';

verifyPassword(seedPw, seedHash, seedSalt, pepper).then(valid => {
  console.log('verify for seed:', valid);
  if (!valid) {
    // try without pepper or empty
    return verifyPassword(seedPw, seedHash, seedSalt, '').then(v2 => console.log('with empty pepper:', v2));
  }
}).catch(e => console.error(e));
