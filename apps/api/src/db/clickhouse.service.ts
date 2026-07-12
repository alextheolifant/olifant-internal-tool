import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ClickhouseService {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly endpoint: string;
  private readonly authHeader: string;

  constructor() {
    const rawURL =
      process.env.CLICKHOUSE_URL ?? 'http://localhost:8123/default';
    const u = new URL(rawURL);
    const db = u.pathname.replace(/^\//, '') || 'default';
    const user = u.username || 'default';
    const pass = u.password || '';
    u.username = '';
    u.password = '';
    u.pathname = '/';
    this.endpoint = `${u.toString()}?database=${encodeURIComponent(db)}&default_format=JSONEachRow`;
    this.authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  async query<T>(sql: string): Promise<T[]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: this.authHeader,
      },
      body: sql,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ClickHouse ${res.status}: ${body.slice(0, 300)}`);
    }

    const text = await res.text();
    if (!text.trim()) return [];
    return text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as T);
  }
}
