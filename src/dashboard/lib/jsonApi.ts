import express from "express";

export function jsonApiRes(data: any, type: string, extra: { meta?: any; links?: any } = {}) {
  const isArray = Array.isArray(data);
  const dataLayer = isArray 
    ? data.map((item: any) => {
        const { id, ...attributes } = item;
        return { type, id: String(id || 'system'), attributes };
      })
    : (() => {
        const { id, ...attributes } = data;
        return { type, id: String(id || attributes.id || 'system'), attributes };
      })();
  
  return {
    jsonapi: { version: "1.1" },
    data: dataLayer,
    ...extra
  };
}

export function jsonApiError(message: string, status: number = 500) {
  return {
    jsonapi: { version: "1.1" },
    errors: [{ status: String(status), detail: message }]
  };
}

export function getAttributes(req: express.Request) {
  return req.body.data?.attributes || req.body;
}
