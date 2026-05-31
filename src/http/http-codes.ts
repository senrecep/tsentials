/**
 * HTTP status code constants.
 * Eliminates magic numbers when working with fetchResult and RequestBuilder.
 */
export const HttpCodes = {
  // 2xx Success
  Ok: 200,
  Created: 201,
  Accepted: 202,
  NoContent: 204,
  // 3xx Redirection
  MovedPermanently: 301,
  Found: 302,
  NotModified: 304,
  // 4xx Client Error
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  Conflict: 409,
  Gone: 410,
  UnprocessableEntity: 422,
  TooManyRequests: 429,
  // 5xx Server Error
  InternalServerError: 500,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
} as const;

export type HttpCode = (typeof HttpCodes)[keyof typeof HttpCodes];
