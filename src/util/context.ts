import { Request } from 'express';

export default class Context {
    static _bindings = new WeakMap<Request, Context>();

    public foo = 'bar';
    public data: Record<string, any>;  
    constructor() {
        this.data = {}
    }

    static bind(req: Request): void {
    const ctx = new Context();
        Context._bindings.set(req, ctx);
    }

    static get(req: Request): Context | null {
        return Context._bindings.get(req) || null;
    }

    public set(key: string, value: any): void {
        this.data[key] = value;
    }

    // Method to get a value from the context
    public get(key: string): any {
        return this.data[key];
    }

}
