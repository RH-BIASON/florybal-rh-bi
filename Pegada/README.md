# BI Calçados Pegada

Dashboard de RH/DP independente, preparado para importar e manter o histórico mensal da Calçados Pegada.

## Relatórios reconhecidos

- Resumo Geral Analítico da folha;
- Provisão de férias;
- Provisão de 13º salário;
- Saldo e programação de férias.

O parser identifica o tipo, a competência, a empresa, o CNPJ e o estabelecimento pelo conteúdo do PDF. O nome do arquivo não é usado como fonte de verdade. Bases de cálculo da folha não compõem a remuneração.

## Base inicial validada

- `RESUMO GERAL ANALITICO 072026.pdf`;
- `prov Ferias.pdf`;
- `prov 13 salario.pdf`;
- `Saldo ferias geral.pdf`.

O ZIP de provisões usado durante o levantamento não faz parte da base ativa.

## Execução local

```powershell
npm.cmd install
npm.cmd run parse
npm.cmd run build
npm.cmd start
```

Acesse `http://127.0.0.1:4001/pegada/`.

## Validação

```powershell
npm.cmd run audit:values
npm.cmd run test:parser
npm.cmd run test:reports
npm.cmd run test:server
```

## Persistência

Em produção, os PDFs e o retrato ativo compactado ficam no bucket privado `pegada-payroll-pdfs`. A tabela `pegada_payroll_imports` guarda o histórico e os metadados de auditoria. Registros analíticos em SQL são opcionais e permanecem desativados por padrão para evitar duplicar milhões de eventos.

As variáveis exigidas são `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. O schema inicial está em `supabase/schema.sql`.
