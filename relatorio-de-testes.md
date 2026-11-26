# Relatório de Testes: API e Banco de Dados

**Projeto:** API de estudos para concursos de TI (Node.js + Express + MongoDB Atlas) com banco local SQLite
**Período:** novembro de 2026
**Escopo:** apenas a API e os bancos de dados. O aplicativo de celular não faz parte deste relatório.

---

## 1. Objetivo

Verificar se a API e os bancos de dados cumprem as regras definidas no levantamento de requisitos, principalmente cadastro e login de usuários, consulta de trilhas e questões, cronograma de estudos e sincronização dos dados entre o celular e o servidor (uso offline).

## 2. Ambiente

| Item | Detalhe |
|---|---|
| Sistema | Windows 11, PowerShell, VS Code |
| Linguagem | Node.js v26 |
| Banco local | SQLite 3.54 |
| Banco do servidor | MongoDB Atlas (plano gratuito) |
| Dados | Fictícios, criados só para os testes |

## 3. Como os testes foram feitos

Foram usados três tipos de teste:

1. **Testes manuais no SQLite.** Para cada tabela, foram inseridos dados válidos e depois dados inválidos de propósito (campo vazio, valor repetido, data errada) para conferir se o banco recusava.
2. **Testes automatizados nos modelos do MongoDB.** Scripts em JavaScript que tentam gravar dados válidos e inválidos e conferem o resultado.
3. **Testes automatizados na API.** Scripts que enviam requisições ao servidor e comparam a resposta com o esperado. Cada caso mostra `OK` ou `FALHOU`.

Também foram feitos **testes manuais no navegador** nas rotas de consulta (catálogo de trilhas, questões e concursos).

**Por que não foi usado o Insomnia?** Os scripts permitem repetir todos os testes com um único comando, mostram claramente quem passou e quem falhou, ficam guardados no Git e conseguem conferir o que foi gravado no banco. O Insomnia exigiria clicar em cada requisição manualmente. Ele seria útil como complemento, para testes exploratórios.

## 4. Resultados

| Área testada | O que foi verificado | Casos | Resultado |
|---|---|---:|---|
| SQLite (14 tabelas) | Campos obrigatórios, valores repetidos, datas, limites e relacionamentos | 54 | Aprovado |
| Modelos do MongoDB | As mesmas regras no banco do servidor | 83 | Aprovado |
| API: cadastro e login | Dados inválidos, senha errada, tokens falsos ou vencidos, conta excluída | 23 | Aprovado |
| API: conta do usuário | Consultar, alterar e excluir a conta | 48 | Aprovado |
| API: sincronização | Envio e download dos dados, repetição de envios, conflitos entre aparelhos | 128 | Aprovado |
| API: limite de tentativas | Bloqueio após muitas tentativas de login ou cadastro | 14 | Aprovado |
| Navegador | Consulta de trilhas, questões e concursos | 15 | Aprovado |
| **Total** | | **365** | **Todos conforme o esperado** |

*"Aprovado" significa que o sistema se comportou como esperado, inclusive quando o esperado era recusar um dado inválido.*

**Principais regras confirmadas:**

- Não é possível cadastrar dois usuários com o mesmo e-mail.
- Senhas são guardadas de forma protegida (nunca em texto puro).
- Tentativas de login seguidas são bloqueadas temporariamente.
- Cada usuário só enxerga e altera os próprios dados.
- Uma etapa de estudo não pode passar de 120 minutos.
- Só pode existir um cronograma ativo por usuário.
- Ao trocar a senha, as sessões antigas deixam de funcionar.
- Ao excluir a conta, todos os dados do usuário são apagados.
- Enviar o mesmo dado duas vezes não cria duplicata.

## 5. Problemas encontrados

Não foi encontrado nenhum defeito de funcionamento no código final da API. Os problemas registrados foram de ambiente e de execução:

| Problema | Causa | Solução |
|---|---|---|
| Testes falhavam com `fetch failed` | O servidor reiniciava sozinho no meio da requisição (recurso `--watch` do Node no Windows) | Usar `npm start` |
| Muitos testes retornavam erro 404 | O servidor não tinha sido reiniciado depois de criar a rota nova | Reiniciar o servidor |
| Um teste falhou depois de uma melhoria | O teste estava desatualizado (esperava uma função que ainda não existia) | Atualizar o teste |
| O servidor não iniciava | Um trecho de código ficou duplicado em um arquivo | Substituir o arquivo completo |
| Conexão com banco errado (`test`) | O arquivo de configuração `.env` não foi salvo | Salvar o arquivo |
| Comandos não encontrados | Terminal na pasta errada, ou instalação ainda não reconhecida | Entrar na pasta `api` e reabrir o VS Code |

## 6. O que não foi testado

- **Integração com o aplicativo.** O app ainda não existe, então a sincronização nunca foi usada com um SQLite real.
- **Desempenho e carga.** Não foi medido o tempo de resposta com muitos usuários ou muitos dados.
- **Segurança avançada.** Não foi feita varredura de vulnerabilidades nas bibliotecas.
- **Alguns resultados do SQLite não foram conferidos.** Por exemplo, a exclusão em cascata dos concursos e algumas consultas de tentativas e notificações.
- **Testes no banco real.** Os testes usaram o banco de desenvolvimento, que é o mesmo dos dados de exemplo.

**Requisitos ainda não implementados:** RF15 (recuperar senha) e RF17 (login com Google). Algumas regras, como gerar o cronograma e calcular a repetição espaçada, ficam no aplicativo e não foram testadas aqui.

## 7. Conclusão

A API e os bancos de dados atenderam às regras testadas: **365 casos, todos com o resultado esperado**. Os problemas encontrados foram de configuração e de processo, e todos foram resolvidos.

**Próximos passos recomendados:**

1. Conferir os resultados do SQLite que ficaram pendentes.
2. Criar um banco separado só para testes.
3. Fazer testes de integração quando o aplicativo existir.
4. Implementar recuperação de senha e login com Google.
5. Complementar com uma coleção do Insomnia para testes manuais.

---

*Como rodar os testes: veja a seção 3.5 e a seção 9 do `README.md`.*
