-- 0184 · Adiantamentos ao cliente na esteira do adm (27/11/2026, a Amanda pelo suporte: "ter a opção de pagar
-- parcial para o cliente, às vezes realizamos adiantamento"). Lista de pagamentos parciais do negócio:
-- [{id, valor, data, obs, por, por_nome, em}]. O "Marcar como pago" continua sendo o fim; o que já saiu
-- antes dele fica aqui, e a tela mostra quanto falta.
alter table public.checklist add column if not exists pagamentos jsonb not null default '[]'::jsonb;
