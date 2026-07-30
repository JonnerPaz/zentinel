// src/core/entities/request-record.ts
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

export interface RequestRecord {
  request: {
    request_id: string;
    timestamp: string;
    method: HttpMethod;
    full_url: string;
    path: string;
    headers: Record<string, any>;
    query_params: Record<string, any>;
    body: any;
    client_ip: string;
    user_agent: string;
  };
  response: {
    status_code: number;
    headers: Record<string, any>;
    body: any;
    latency_ms: number;
    response_size_bytes: number;
    error_message?: string;
    stack_trace?: string;
  };
}
