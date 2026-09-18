import { MongoClient, type ClientSession } from 'mongodb';

export interface TransactionStore {
  /** Run all database work against one retryable MongoDB session. */
  executeTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
    options?: TransactionExecutionOptions,
  ): Promise<T>;
}

export interface TransactionExecutionOptions {
  /** Bounds the commit phase. The queue still bounds the caller's total wait. */
  maxCommitTimeMs?: number;
}

const DEFAULT_MAX_COMMIT_TIME_MS = 5_000;

/**
 * MongoDB is the existing authoritative activity store for Luffy. This adapter
 * exposes its multi-document transaction capability without introducing a
 * second persistence architecture or making Redis part of the correctness path.
 */
export class MongoTransactionStore implements TransactionStore {
  constructor(
    private readonly client: MongoClient,
    private readonly defaults: TransactionExecutionOptions = {},
  ) {}

  async executeTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
    options: TransactionExecutionOptions = {},
  ): Promise<T> {
    const maxCommitTimeMS = options.maxCommitTimeMs ?? this.defaults.maxCommitTimeMs ?? DEFAULT_MAX_COMMIT_TIME_MS;
    return this.client.withSession(async (session) => {
      const result = await session.withTransaction(
        () => work(session),
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
          maxCommitTimeMS,
        },
      );
      // Domain operations always return a value. Treat an undefined callback
      // result as an invalid transaction contract rather than silently losing it.
      if (result === undefined) {
        throw new Error('Mongo transaction completed without a result');
      }
      return result as T;
    });
  }
}

export function createMongoTransactionStore(
  client: MongoClient,
  options?: TransactionExecutionOptions,
): MongoTransactionStore {
  return new MongoTransactionStore(client, options);
}
