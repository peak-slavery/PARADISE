import { promises as dns } from 'node:dns';
import { MongoClient } from 'mongodb';

export async function reportMongoReadiness(label, uri) {
  const host = /^mongodb\+srv:\/\/[^@]+@([^/?]+)/.exec(uri ?? '')?.[1];
  if (!host) {
    console.log(`${label}: missing valid mongodb+srv URI`);
    return false;
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000, tls: true });
  try {
    const records = await dns.resolveSrv(`_mongodb._tcp.${host}`);
    if (!records.length) throw new Error('no SRV records');
    await client.connect();
    await client.db().command({ ping: 1 });
    console.log(`${label}: connected and pinged (${records.length} endpoints)`);
    return true;
  } catch {
    console.log(`${label}: unavailable (DNS/TLS/auth failed)`);
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}
