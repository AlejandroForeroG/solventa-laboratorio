import { readFile } from 'node:fs/promises';
import pg from 'pg';
const connectionString = process.env.DATABASE_URL;
if (!connectionString)
    throw new Error('Defina DATABASE_URL en la terminal usando una entrada segura; no la escriba en el repositorio.');
const client = new pg.Client({ connectionString });
try {
    await client.connect();
    await client.query(await readFile('experimentos/infra/schema.sql', 'utf8'));
    console.log('Esquemas y roles experimentales preparados.');
}
finally {
    await client.end();
}
