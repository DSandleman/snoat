import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getSupabase } from "@/lib/supabase";

/**
 * Holder prosjektlisten synkron med byggingen som skjer i backend.
 *
 * Backend skriver status og logger til `deployments` underveis
 * (03_deployment_flow.md). Vi abonnerer på tabellen i stedet for å polle – RLS
 * gjør at vi kun får hendelser for egne rader, så det trengs ingen filtrering
 * her.
 */
export function useDeploymentsRealtime(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channel = getSupabase()
      .channel("snoat-deployments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deployments" },
        () => void queryClient.invalidateQueries({ queryKey: ["projects"] }),
      )
      .subscribe();

    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
