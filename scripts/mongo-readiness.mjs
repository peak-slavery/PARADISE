import { promises as dns } from 'node:dns';
import { MongoClient } from 'mongodb';

export async function reportMongoReadiness(label, uri) {
  const value = uri?.trim() ?? '';
  const srvHost = /^mongodb\+srv:\/\/[^@]+@([^/?]+)/.exec(value)?.[1];
  const standardHost = /^mongodb:\/\/[^@]+@([^/?]+)/.exec(value)?.[1];
  const host = srvHost ?? standardHost;
  if (!host) {
    console.log(`${label}: missing valid secure MongoDB URI`);
    return false;
  }
  const client = new MongoClient(value, {
    serverSelectionTimeoutMS: 15_000,
    tls: srvHost ? true : /(?:[?&])tls=true(?:&|$)/i.test(value),
  });
  try {
    let endpointCount = 1;
    if (srvHost) {
      const records = await dns.resolveSrv(`_mongodb._tcp.${host}`);
      if (!records.length) throw new Error('no SRV records');
      endpointCount = records.length;
    }
    await client.connect();
    await client.db().command({ ping: 1 });
    console.log(`${label}: connected and pinged (${endpointCount} endpoint${endpointCount === 1 ? '' : 's'})`);
    return true;
  } catch {
    console.log(`${label}: unavailable (DNS/TLS/auth failed)`);
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}
