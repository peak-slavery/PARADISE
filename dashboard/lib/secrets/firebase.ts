import { loadSecret } from '../secret-vault';

export type FirebaseAdminConfig = {
  projectId?: string;
  clientEmail?: string;
  privateKey: string;
  storageBucket?: string;
};

export async function createFirebaseAdminConfig(): Promise<FirebaseAdminConfig | null> {
  const raw = await loadSecret('firebase.admin.service_account');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
    if (!privateKey) return null;
    return {
      projectId: typeof parsed.project_id === 'string' ? parsed.project_id : undefined,
      clientEmail: typeof parsed.client_email === 'string' ? parsed.client_email : undefined,
      privateKey,
      storageBucket: await loadSecret('firebase.storage.bucket') ?? undefined,
    };
  } catch {
    return null;
  }
}
