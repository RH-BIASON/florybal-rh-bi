# BI Florybal Chocolates

Aplicacao web local para importar folhas de pagamento em PDF e analisar dados de RH/DP por competencia e filial.

## Como usar

```powershell
npm.cmd install
python -m pip install pymupdf
npm.cmd run parse
npm.cmd run build
npm.cmd start
```

Abra `http://127.0.0.1:4000`.

Para desenvolvimento com hot reload:

```powershell
npm.cmd run dev
```

## Dados e motor

- PDFs de origem: `FOPAG Florybal 122025.pdf`, `012026`, `022026`, `032026`, `042026`.
- JSON oficial atual: `data/payroll.json`.
- Parser: `scripts/parse_payroll.py`.
- Regras configuraveis de eventos: `scripts/event_rules.json`.
- Testes automaticos do parser: `scripts/test_parser.py`.
- Auditoria valor a valor contra os PDFs: `scripts/audit_payroll_values.py`.
- Historico de importacoes manuais: `data/import-history/`.
- Schema Supabase: `supabase/schema.sql`.

O painel permite filtrar 1, 2, 3 ou todos os meses, combinar matriz e filiais, buscar colaborador/contrato/cargo, importar novos PDFs, visualizar admissoes, rescisoes, horas extras, faltas/atrasos, variaveis, encargos, consignados e ferias.
Tambem existe a aba `Auditoria`, que mostra reconciliacao dos PDFs, historico de importacoes manuais, eventos nao classificados e diagnosticos do parser.

## Supabase

O app funciona em dois modos:

- Sem Supabase: usa `data/payroll.json` e `data/import-history/`, bom para desenvolvimento local.
- Com Supabase: salva importacoes, registros, eventos, auditorias e PDFs originais no banco/storage.

Para ativar:

1. Crie um projeto no Supabase.
2. Rode `supabase/schema.sql` no SQL Editor.
3. Crie um bucket privado chamado `payroll-pdfs` no Storage.
4. Copie `.env.example` para `.env`.
5. Preencha:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=payroll-pdfs
```

Use a chave `service_role` somente no backend. Nao exponha essa chave no frontend.

Quando o Supabase esta configurado, a rota `/api/upload` grava:

- `payroll_imports`: resumo e snapshot da base validada.
- `payroll_import_files`: arquivos enviados e hash SHA-256.
- `payroll_records`: registro colaborador/mes.
- `payroll_events`: verbas/eventos da folha.
- `payroll_audit_results`: reconciliacao, diagnosticos e verbas nao classificadas.
- Storage `payroll-pdfs`: PDFs originais.

## Validacao atual

Base reprocessada em `data/payroll.json`:

- 5 PDFs importados.
- 5 competencias: 12/2025 a 04/2026.
- 20 unidades/filiais identificadas nos PDFs.
- 476 colaboradores unicos no conjunto filtrado completo.
- 1.871 registros colaborador/mes.
- Reconciliacao com o total geral de cada PDF: bruto, descontos e liquido batendo com diferenca `R$ 0,00`.
- Eventos nao classificados na base atual: `0`.
- Diagnosticos de pagina/importacao na base atual: `0`.

Para validar regressao do motor:

```powershell
npm.cmd run test:parser
```

Para conferir valor a valor contra o texto dos PDFs importados:

```powershell
npm.cmd run audit:values
```

## Importacao manual

- Upload processado de forma transacional: a base oficial so e substituida se bruto, descontos e liquido baterem com o total geral do PDF.
- Cada upload manual aprovado salva um snapshot em `data/import-history/*.payroll.json` e um resumo em `*.metadata.json`.
- Importacoes bloqueadas ou com erro tambem geram metadata com diagnostico.
- `GET /api/import-history` lista as importacoes salvas.
- A resposta de erro inclui reconciliacao, diagnosticos e eventos nao classificados quando existirem.

## Diretrizes de UI aplicadas

- Importacao por area de arrastar e soltar PDFs, com validacao de tipo de arquivo.
- Sem rolagem horizontal interna em filtros, listas ou paineis.
- Filiais exibidas como codigos compactos nos filtros e como `codigo - nome` nas listas operacionais.
- KPIs financeiros usam valores compactos no card e valores completos nas listas/auditoria.
- Listas limitam a visualizacao inicial e orientam exportar CSV para a base completa.
- Graficos evitam pizza para encargos e usam barras/tendencias mais auditaveis.
- Area `Horas extras` mostra HE 50%, HE 100%, reflexos de HE mes a mes, valores pagos e top 5 por colaborador/filial respeitando os filtros ativos.
- Area `Faltas e atrasos` mostra faltas, atrasos e repousos descontados com alerta amarelo/vermelho por competencia.
- Area `Variaveis` mostra comissoes, premios/bonificacoes e adicionais.
- Area `Auditoria` mostra se a base atual bateu com os PDFs, quais uploads manuais ocorreram e se algum PDF novo trouxe verba sem regra.
