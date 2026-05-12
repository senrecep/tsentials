/**
 * Categorizes the type of error that occurred.
 */
export const ErrorType = {
  Failure: 'Failure',
  Unexpected: 'Unexpected',
  Validation: 'Validation',
  Conflict: 'Conflict',
  NotFound: 'NotFound',
  Unauthorized: 'Unauthorized',
  Forbidden: 'Forbidden',
  Unknown: 'Unknown',
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];
