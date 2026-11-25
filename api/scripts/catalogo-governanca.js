const trilha = {
  _id: 'trilha-gov',
  nome: 'Governança e Gestão de TI',
  materias: [
    { _id: 'mat-itil', nome: 'ITIL', temas: [{ _id: 'tema-itil-servicos', nome: 'Gestão de serviços' }] },
    { _id: 'mat-cobit', nome: 'COBIT', temas: [{ _id: 'tema-cobit-governanca', nome: 'Governança e gestão' }] },
    { _id: 'mat-pmbok', nome: 'PMBOK', temas: [{ _id: 'tema-gestao-projetos', nome: 'Gestão de Projetos' }] },
    { _id: 'mat-ageis', nome: 'Metodologias Ágeis', temas: [
      { _id: 'tema-scrum', nome: 'Scrum' }, { _id: 'tema-kanban', nome: 'Kanban' },
    ] },
    { _id: 'mat-legislacao', nome: 'Legislação de TI', temas: [
      { _id: 'tema-lgpd', nome: 'LGPD' }, { _id: 'tema-marco-civil', nome: 'Marco Civil' },
    ] },
  ],
};

const questoes = [
  {
    _id: 'gov-itil-incidente', materiaId: 'mat-itil', temaId: 'tema-itil-servicos',
    enunciado: 'Um portal ficou indisponível. Na gestão de incidentes do ITIL, qual é a prioridade imediata?',
    alternativas: ['Revisar o orçamento anual do portal.', 'Restabelecer o serviço para os usuários.', 'Concluir a análise da causa raiz antes de restaurar o serviço.'], gabarito: 'B',
  },
  {
    _id: 'gov-itil-problema', materiaId: 'mat-itil', temaId: 'tema-itil-servicos',
    enunciado: 'O mesmo erro interrompe um serviço toda semana. Qual prática do ITIL investiga suas causas para reduzir a recorrência?',
    alternativas: ['Gestão de problemas.', 'Gestão do catálogo de serviços.', 'Gestão de níveis de serviço.'], gabarito: 'A',
  },
  {
    _id: 'gov-cobit-direcao', materiaId: 'mat-cobit', temaId: 'tema-cobit-governanca',
    enunciado: 'Segundo o COBIT, qual atividade cabe ao órgão de governança de TI?',
    alternativas: ['Executar a rotina diária de cópias de segurança.', 'Distribuir chamados entre os técnicos.', 'Avaliar necessidades das partes interessadas e orientar prioridades.'], gabarito: 'C',
  },
  {
    _id: 'gov-cobit-monitoramento', materiaId: 'mat-cobit', temaId: 'tema-cobit-governanca',
    enunciado: 'O conselho definiu objetivos para os investimentos em TI. Qual ação corresponde ao monitoramento desses objetivos?',
    alternativas: ['Comparar os resultados alcançados com as metas aprovadas.', 'Instalar atualizações nos servidores.', 'Programar as funcionalidades de uma entrega.'], gabarito: 'A',
  },
  {
    _id: 'gov-pmbok-risco', materiaId: 'mat-pmbok', temaId: 'tema-gestao-projetos',
    enunciado: 'Qual situação representa um risco futuro para o prazo de um projeto?',
    alternativas: ['Um defeito já foi encontrado na entrega de ontem.', 'Uma licença poderá atrasar e impedir o início dos testes.', 'O termo de aceite já foi assinado.'], gabarito: 'B',
  },
  {
    _id: 'gov-pmbok-interessados', materiaId: 'mat-pmbok', temaId: 'tema-gestao-projetos',
    enunciado: 'Um sistema mudará o atendimento ao público. Quem deve ser considerado na identificação das partes interessadas?',
    alternativas: ['Somente quem financia o projeto.', 'Somente quem desenvolve o sistema.', 'Também os atendentes e cidadãos afetados pela mudança.'], gabarito: 'C',
  },
  {
    _id: 'gov-kanban-limite', materiaId: 'mat-ageis', temaId: 'tema-kanban',
    enunciado: 'A etapa de testes atingiu seu limite de trabalho em andamento no Kanban. Qual ação respeita o limite?',
    alternativas: ['Ajudar a concluir os testes em andamento antes de puxar outro item.', 'Mover outro item para testes sem registrá-lo no quadro.', 'Iniciar mais testes até que todos os itens estejam em execução.'], gabarito: 'A',
  },
  {
    _id: 'gov-kanban-fluxo', materiaId: 'mat-ageis', temaId: 'tema-kanban',
    enunciado: 'Para identificar onde as entregas se acumulam, o que a equipe deve representar no quadro Kanban?',
    alternativas: ['Apenas os cargos dos participantes.', 'Apenas as datas das próximas reuniões.', 'As etapas do fluxo e os itens de trabalho em cada etapa.'], gabarito: 'C',
  },
  {
    _id: 'gov-lgpd-necessidade', materiaId: 'mat-legislacao', temaId: 'tema-lgpd',
    enunciado: 'Um cadastro solicita apenas os dados pessoais indispensáveis ao serviço. Qual princípio do art. 6º da LGPD essa decisão aplica?',
    alternativas: ['Livre acesso.', 'Necessidade.', 'Não discriminação.'], gabarito: 'B',
  },
  {
    _id: 'gov-lgpd-finalidade', materiaId: 'mat-legislacao', temaId: 'tema-lgpd',
    enunciado: 'Ao informar para que usará os dados pessoais, o órgão apresenta um propósito específico e legítimo. A qual princípio do art. 6º da LGPD isso corresponde?',
    alternativas: ['Segurança.', 'Qualidade dos dados.', 'Finalidade.'], gabarito: 'C',
  },
].map(questao => ({ ...questao, banca: 'AprovaTech (questão autoral)', ano: 2026 }));

module.exports = { trilha, questoes };
