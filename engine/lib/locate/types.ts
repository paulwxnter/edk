export type Observation={type:"Feature";id?:string;geometry:{type:string;coordinates:any};properties:Record<string,any>};
export type SearchPayload={isSuccess:boolean;result_id:string;data:{query:string;duration_ms:number;geojson:{type:string;features:Observation[]};regions:{id:string;name:string;layer:string}[];year?:string|number|null;answer?:string}};
