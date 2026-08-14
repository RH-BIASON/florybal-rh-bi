# Area de trabalho BI RH/DP

Portal unico para acesso aos ambientes de business intelligence das empresas.

## Estrutura

```text
BI/
|-- src/                  Portal e seletor de empresas
|-- Florybal/             Aplicacao, API, parser e dados da Florybal
|-- Pegada/
|   |-- docs/             Questionarios e documentacao funcional
|   `-- public/brand/     Logos e demais arquivos de marca
|-- Dockerfile            Build conjunto para producao
`-- render.yaml           Configuracao de deploy
```

## Ambientes

- `/`: seletor de empresas;
- `/florybal/`: BI Florybal Chocolates, com autenticacao e base existentes;
- `/pegada/`: BI Calçados Pegada, com folha, provisões, programação de férias, importação e acessos.

As bases, regras de rubricas, usuarios e importacoes devem permanecer isolados por empresa. O codigo atual da Florybal esta em `Florybal/`. A Pegada devera receber aplicacao, banco, autenticacao, parser e APIs proprios antes de ser marcada como ambiente de producao.

## Onde colocar novos arquivos

- Codigo compartilhado do portal: `src/`;
- Codigo e regras da Florybal: `Florybal/`;
- Documentos funcionais da Pegada: `Pegada/docs/`;
- Logos e identidade da Pegada: `Pegada/public/brand/`;
- Arquivos temporarios e logs locais: `.local/` (ignorado pelo Git).

Os PDFs de referencia da Florybal permanecem na raiz de `Florybal/`, pois os testes atuais do parser usam esses caminhos. Uma mudanca futura deve atualizar os scripts e testes no mesmo commit.

## Desenvolvimento

```powershell
npm.cmd ci
npm.cmd --prefix Florybal ci
npm.cmd run build
$env:PORT='4003'
$env:DISABLE_AUTH='true'
npm.cmd start
```

Abra `http://127.0.0.1:4003/`.

## Testes da Florybal

```powershell
npm.cmd --prefix Florybal run test:server
npm.cmd --prefix Florybal run test:parser
npm.cmd --prefix Florybal run test:reports
```

## Producao

O Docker da raiz compila o portal e o BI Florybal. O mesmo servidor entrega as interfaces e mantem as APIs atuais em `/api/*`.
