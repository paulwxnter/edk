import { redirect } from "react-router";

// The primitives live at /model now.
export const loader = ({ request }: { request: Request }) => redirect(`/model${new URL(request.url).hash}`, 301);
