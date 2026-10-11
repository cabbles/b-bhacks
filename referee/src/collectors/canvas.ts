import { config } from '../config.ts';

export type CanvasSubmission = {
    workflow_state: string;
    submitted_at: string | null;
    attachment_bytes: number;
    attachment_count: number;
    body_bytes: number;
};

export async function ownSubmission(courseId: number, assignmentId: number): Promise<CanvasSubmission> {
    if (!config.canvasToken) throw new Error('CANVAS_TOKEN not set');
    const r = await fetch(
        `${config.canvasBase}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self`,
        { headers: { Authorization: `Bearer ${config.canvasToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!r.ok) throw new Error(`canvas ${r.status}`);
    const j: any = await r.json();
    const atts: any[] = j.attachments ?? [];
    return {
        workflow_state: String(j.workflow_state ?? 'unsubmitted'),
        submitted_at: j.submitted_at ?? null,
        attachment_bytes: atts.reduce((n, a) => n + Number(a.size ?? 0), 0),
        attachment_count: atts.length,
        body_bytes: j.body ? Buffer.byteLength(String(j.body)) : 0,
    };
}
