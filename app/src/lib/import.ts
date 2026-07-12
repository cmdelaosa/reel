import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

/* In-app TV Time import: upload zip → import_jobs(pending) → invoke the
   `importer` edge function → poll the job to done. */

export const importJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "running", "done", "error"]),
  report: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type ImportJob = z.infer<typeof importJobSchema>;

const jobsKey = ["importJobs"] as const;

export function useLatestImportJob() {
  return useQuery({
    queryKey: jobsKey,
    refetchInterval: (query) => {
      const j = query.state.data as ImportJob | null | undefined;
      return j && (j.status === "pending" || j.status === "running") ? 2000 : false;
    },
    queryFn: async (): Promise<ImportJob | null> => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("id, status, report, created_at, finished_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? importJobSchema.parse(data) : null;
    },
  });
}

/** Continue a walled import: re-invoke the importer for an in-progress job so it
 *  processes the next chunk (idempotent; the server resumes from its cursor). */
export function useContinueImport() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const path = `${session!.user.id}/${jobId}.zip`;
      const { error } = await supabase.functions.invoke("importer", { body: { job_id: jobId, path } });
      if (error) throw new Error(`import failed to continue: ${error.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: jobsKey }),
  });
}

export function useStartImport() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 25 * 1024 * 1024) throw new Error("That file is over 25MB — is it the right export?");
      const userId = session!.user.id;

      const { data: job, error: jobErr } = await supabase
        .from("import_jobs")
        .insert({ user_id: userId, kind: "tvtime_zip", status: "pending" })
        .select("id")
        .single();
      if (jobErr || !job) throw new Error(jobErr?.message ?? "could not create job");

      const path = `${userId}/${job.id}.zip`;
      const { error: upErr } = await supabase.storage
        .from("imports")
        .upload(path, file, { upsert: true, contentType: "application/zip" });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);

      const { error: invErr } = await supabase.functions.invoke("importer", {
        body: { job_id: job.id, path },
      });
      if (invErr) throw new Error(`import failed to start: ${invErr.message}`);
      return job.id as string;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: jobsKey }),
  });
}
