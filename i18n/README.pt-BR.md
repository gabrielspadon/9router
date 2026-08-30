# 9Router

> Resumo traduzido e abreviado. A documentação canônica está em inglês, em
> [README.md](../README.md) e [docs/README.md](../docs/README.md).

O 9Router é um gateway local de roteamento de IA com painel de controle. Ele
expõe um único endpoint compatível com OpenAI em `/v1/*`, traduz cada
requisição para o formato esperado pelo provedor escolhido e alterna entre
modelos e contas, de modo que uma única configuração do cliente continua
funcionando quando um provedor esgota a cota, aplica limite de taxa ou falha.

<p align="center">
  <img src="../images/9router.png" alt="Painel do 9Router" width="800"/>
</p>

## Instalação

```bash
npm install -g 9router
9router
```

O painel fica em `http://localhost:20128/dashboard` e a API compatível com
OpenAI em `http://localhost:20128/v1`. O primeiro login usa
`INITIAL_PASSWORD`, cujo valor padrão é `123456`. Troque esse valor.

Os passos completos estão em
[docs/getting-started.md](../docs/getting-started.md).

## Status do fork

Este repositório é um fork mantido de forma independente de
[decolua/9router](https://github.com/decolua/9router). Ele acompanha o projeto
original enquanto carrega correções e integrações locais no seu próprio ritmo.
O nome 9Router, o histórico do projeto original, a licença e a atribuição de
autoria são preservados.

O projeto original é uma referência somente leitura e todo o desenvolvimento
acontece aqui. Este fork não é endossado pelo projeto original e não fala em
nome dele.

O texto completo, incluindo o processo de sincronização, está na seção
"Fork status" do [README.md](../README.md) em inglês.

## Documentação

- [README.md](../README.md), a página principal em inglês.
- [docs/README.md](../docs/README.md), o índice da documentação.

## Licença

MIT. Veja [LICENSE](../LICENSE).
