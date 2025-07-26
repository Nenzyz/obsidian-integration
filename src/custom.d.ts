declare module "*.txt" {
	const content: string;
	export default content;
}

declare module "*.json" {
	const content: unknown;
	export default content;
}

declare module "mermaid_renderer.esbuild" {
	const content: Buffer;
	export default content;
}

declare module "sort-any" {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export default function sortAny<T>(item: T): T;
}

declare module 'confluence.js' {
  export interface Client {
    content: any;
    space: any;
  }
  
  export type Config = any;
  export type RequestConfig = any;
  export type Callback<T> = (error: any, data?: T) => void;
  
  export namespace Api {
    export class Content {
      constructor(client: any);
      getContentById(params: any): Promise<any>;
    }
    export class Space {
      constructor(client: any);
    }
    export class ContentAttachments {
      constructor(client: any);
    }
    export class ContentLabels {
      constructor(client: any);
    }
    export class Users {
      constructor(client: any);
    }
  }
  
  export namespace Config {
    export type Error = any;
  }
  
  export class AuthenticationService {
    static getAuthenticationToken(auth: any, config: any): Promise<string>;
  }
  
  export default Client;
}
