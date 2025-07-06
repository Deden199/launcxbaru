const createSuccessResponse = (body: any) => {
    return {
      success: true,
      result: body,
    };
  };
  
  const createErrorResponse = (error: any, body?: any) => {
    return {
      success: false,
      result: body || null,
      error: error || error.message,
    };
  };
  
  export { createErrorResponse, createSuccessResponse };
  