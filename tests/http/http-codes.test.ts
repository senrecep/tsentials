import type { HttpCode } from '../../src/http/http-codes.js';
import { HttpCodes } from '../../src/http/http-codes.js';

describe('HttpCodes', () => {
  describe('2xx Success', () => {
    it('Ok is 200', () => expect(HttpCodes.Ok).toBe(200));
    it('Created is 201', () => expect(HttpCodes.Created).toBe(201));
    it('Accepted is 202', () => expect(HttpCodes.Accepted).toBe(202));
    it('NoContent is 204', () => expect(HttpCodes.NoContent).toBe(204));
  });

  describe('3xx Redirection', () => {
    it('MovedPermanently is 301', () => expect(HttpCodes.MovedPermanently).toBe(301));
    it('Found is 302', () => expect(HttpCodes.Found).toBe(302));
    it('NotModified is 304', () => expect(HttpCodes.NotModified).toBe(304));
  });

  describe('4xx Client Error', () => {
    it('BadRequest is 400', () => expect(HttpCodes.BadRequest).toBe(400));
    it('Unauthorized is 401', () => expect(HttpCodes.Unauthorized).toBe(401));
    it('Forbidden is 403', () => expect(HttpCodes.Forbidden).toBe(403));
    it('NotFound is 404', () => expect(HttpCodes.NotFound).toBe(404));
    it('MethodNotAllowed is 405', () => expect(HttpCodes.MethodNotAllowed).toBe(405));
    it('Conflict is 409', () => expect(HttpCodes.Conflict).toBe(409));
    it('Gone is 410', () => expect(HttpCodes.Gone).toBe(410));
    it('UnprocessableEntity is 422', () => expect(HttpCodes.UnprocessableEntity).toBe(422));
    it('TooManyRequests is 429', () => expect(HttpCodes.TooManyRequests).toBe(429));
  });

  describe('5xx Server Error', () => {
    it('InternalServerError is 500', () => expect(HttpCodes.InternalServerError).toBe(500));
    it('BadGateway is 502', () => expect(HttpCodes.BadGateway).toBe(502));
    it('ServiceUnavailable is 503', () => expect(HttpCodes.ServiceUnavailable).toBe(503));
    it('GatewayTimeout is 504', () => expect(HttpCodes.GatewayTimeout).toBe(504));
  });

  it('is usable as a type', () => {
    const code: HttpCode = HttpCodes.Ok;
    expect(code).toBe(200);
  });
});
