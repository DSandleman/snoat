-- ---------------------------------------------------------------------------
-- Marked og valuta på abonnementet – implementerer markedsdelen av
-- CONTEXT_FOR_AI/12_billing_and_plans.md.
--
-- Bakgrunn: prisene lå tidligere som kroner i backend (`PLAN_PRICES_ORE`) og
-- som ferdige strenger i oversettelsesfilene («199 kr / mnd»). Norske kroner og
-- 25 % mva var altså bakt inn i selve definisjonen av hva en plan er. Disse
-- kolonnene er det som gjør at en rad kan si noe annet.
--
-- Må være idempotent: db-migrate kjører alle migrasjoner på nytt ved oppstart.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists billing_country text,
  add column if not exists currency text,
  add column if not exists customer_kind text;

-- ⚠️ Ingen ny RLS-policy her, og det er ikke en forglemmelse.
--
-- `subscriptions` har fra 0004 *kun* en select-policy – ingen insert, update
-- eller delete i det hele tatt. Kolonnene arver det: `authenticated` kan lese
-- sin egen rad og ingenting mer, og all skriving går gjennom backend med
-- service-role-nøkkelen etter en verifisert Stripe-signatur.
--
-- Det er like viktig her som for `plan`. Kunne en bruker satt `currency` selv
-- fra nettleserkonsollen, kunne hen valgt hvilken prisliste kontoen skulle
-- måles mot – og siden `resolveMarket()` lar en lagret valuta overstyre alt
-- annet, ville den løgnen overlevd helt fram til kassen.

comment on column public.subscriptions.billing_country is
  'Faktureringsland (ISO-3166-1 alpha-2) fra adressen i Stripe. Grunnlaget Stripe Tax regner avgift etter. Ikke utledet av språk eller valuta – en kunde kan betale i euro og holde til i Norge.';

comment on column public.subscriptions.currency is
  'Valutaen abonnementet faktureres i (ISO-4217 lowercase, som hos Stripe). LÅST etter første faktura: Stripe knytter valutaen til kunden, ikke til abonnementet, så den kan ikke byttes uten en ny Stripe-kunde. Derfor overstyrer denne både visningsspråk og alt annet i resolveMarket().';

comment on column public.subscriptions.customer_kind is
  'individual eller business, avledet av om kunden oppga mva-/organisasjonsnummer i kassen. Avgjør omvendt avgiftsplikt i EU.';

-- Enum ville vært strengere, men valutaer og landkoder er data vi henter fra
-- Stripe, ikke tilstander vi selv kontrollerer. En enum måtte fått en migrasjon
-- hver gang vi la til et marked, og ville feilet skrivingen fra webhooken – det
-- vil si midt i en betaling – hvis Stripe sendte noe vi ikke hadde forutsett.
-- Sjekkene under fanger formfeil uten å gjøre det.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_currency_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_currency_check
      check (currency is null or currency ~ '^[a-z]{3}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_billing_country_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_billing_country_check
      check (billing_country is null or billing_country ~ '^[A-Z]{2}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_customer_kind_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_customer_kind_check
      check (customer_kind is null or customer_kind in ('individual', 'business'));
  end if;
end
$$;

-- Etterfyll eksisterende betalende kunder.
--
-- NULL og ikke 'nok' for alle: NULL betyr «ingen valuta er låst ennå», og det
-- er sant for enhver konto som aldri har betalt. Satte vi 'nok' overalt, ville
-- hver eneste gratisbruker i verden vært låst til kroner for alltid – etter
-- rekkefølgen i resolveMarket() ville lagret valuta slått visningsspråket, og
-- en tysk bruker som registrerte seg i går ville aldri fått se en euro-pris.
--
-- Kun rader som faktisk har et Stripe-abonnement røres. De er per i dag alle i
-- kroner, siden det var den eneste valutaen som fantes før denne migrasjonen.
update public.subscriptions
   set currency = 'nok'
 where currency is null
   and stripe_subscription_id is not null;

-- `billing_country` etterfylles ikke. Vi *har* ikke landet for de radene –
-- adressen ligger hos Stripe, ikke her – og å gjette 'NO' ville lagt et
-- avgiftsgrunnlag inn i databasen på magefølelse. Neste webhook for hver kunde
-- fyller det inn fra kundeobjektet.
