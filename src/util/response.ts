const createSuccessResponse = (body: any) => {
    return {
      success: true,
      result: body,
    };
  };
  
  const createErrorResponse = (error: any, body?: any) => {
        const message =
      typeof error === 'string'
        ? error
        : error && typeof error.message === 'string'
        ? error.message
        : String(error);
    return {
      success: false,
      result: body || null,
      error: message,
    };
  };
  
  export { createErrorResponse, createSuccessResponse };
  