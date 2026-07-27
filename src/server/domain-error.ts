export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = "请求无法完成，请检查后重试。",
  ) {
    super(message);
    this.name = "DomainError";
  }
}
