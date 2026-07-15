import { pool } from './index.js';

export interface User {
  id: number;
  email: string;
  password_hash: string;
}

export const getUserByEmail = (email: string) =>
  pool.query<User>('SELECT * FROM users WHERE email = $1', [email]).then((r) => r.rows[0]);
