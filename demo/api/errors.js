// Errors the API answers on purpose. The body carries a stable `code` (the UI translates
// it), an English `message` for anyone reading the response, and the values the message
// needs, e.g. { code: 'TITLE_TOO_LONG', message: '…', max: 200 }.

const MESSAGES = {
  BAD_JSON: () => 'The request body is not JSON',
  TITLE_REQUIRED: () => 'Enter a title',
  TITLE_TOO_LONG: ({ max }) => `Keep the title to ${max} characters or fewer`,
  DONE_NOT_BOOLEAN: () => 'done must be true or false',
  NOTHING_TO_CHANGE: () => 'Nothing to change',
  NOT_FOUND: () => 'Todo not found',
  NOTE_NOT_STRING: () => 'The note must be a string',
  NOTE_TOO_LONG: ({ max }) => `Keep the note to ${max} characters or fewer`,
  UNAUTHORIZED: () => 'Sign in to use the API',
};

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {keyof typeof MESSAGES} code
   * @param {Record<string, string | number>} [params]
   */
  constructor(status, code, params = {}) {
    super(MESSAGES[code](params));
    this.status = status;
    this.code = code;
    this.params = params;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...this.params };
  }
}
