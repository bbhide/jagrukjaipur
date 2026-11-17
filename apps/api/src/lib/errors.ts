export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, "bad_request", details);
export const unauthorized = (msg = "Please log in to continue.") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "You do not have access to this resource.") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found.") => new HttpError(404, msg, "not_found");
export const conflict = (msg: string) => new HttpError(409, msg, "conflict");
export const tooMany = (msg = "Too many requests. Please try again in a few minutes.") => new HttpError(429, msg, "rate_limited");
