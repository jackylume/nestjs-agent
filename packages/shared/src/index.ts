export interface HealthResponse {
  status: 'ok';
}

export interface DatabaseHealthResponse extends HealthResponse {
  database: 'connected';
}
