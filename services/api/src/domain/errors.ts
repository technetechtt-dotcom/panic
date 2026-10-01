export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UniqueConflictError extends Error {
  constructor() {
    super("Unique constraint violated");
    this.name = "UniqueConflictError";
  }
}
