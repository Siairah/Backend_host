export function sanitizeError(error) {
  if (!error) {
    return 'An error occurred. Please try again.';
  }

  let message = '';
  
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String(error.message);
  } else {
    return 'An error occurred. Please try again.';
  }

  message = message.replace(/https?:\/\/localhost[^\s]*/gi, '');
  message = message.replace(/https?:\/\/127\.0\.0\.1[^\s]*/gi, '');
  message = message.replace(/localhost:\d+/gi, '');
  message = message.replace(/127\.0\.0\.1:\d+/gi, '');
  message = message.replace(/localhost/gi, '');
  message = message.replace(/127\.0\.0\.1/gi, '');
  message = message.replace(/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/gi, '');
  message = message.replace(/Failed to fetch|NetworkError|Network request failed/gi, '');
  message = message.replace(/CORS|CORS policy/gi, '');
  message = message.replace(/at\s+.*localhost.*/gi, '');
  message = message.replace(/at\s+.*127\.0\.0\.1.*/gi, '');
  message = message.replace(/\[.*localhost.*\]/gi, '');
  message = message.replace(/\[.*127\.0\.0\.1.*\]/gi, '');
  message = message.replace(/Error:\s*/gi, '');
  message = message.replace(/TypeError|ReferenceError|SyntaxError/gi, '');
  
  message = message.trim();
  
  if (!message || message.length === 0) {
    return 'An error occurred. Please try again.';
  }
  
  if (message.length > 100) {
    return 'An error occurred. Please try again.';
  }
  
  return message;
}

