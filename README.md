# Área de trabalho BI RH/DP

Portal único para acesso aos ambientes de business intelligence das empresas.

## Ambientes

- `/`: seletor de empresas;
- `/florybal/`: BI Florybal Chocolates, com autenticação e base existentes;
- `/pegada/`: entrada do BI Calçados Pegada, ainda em implantação.

As bases, regras de rubricas e importações permanecem separadas por empresa. O código atual da Florybal está em `Florybal/`; os arquivos iniciais da Pegada estão em `Pegada/`.

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

## Produção

O Docker da raiz compila o portal e o BI Florybal. O mesmo servidor entrega as interfaces e mantém as APIs atuais em `/api/*`.

A Pegada deverá receber banco, autenticação, parser e APIs próprios antes de ser marcada como ambiente de produção.
