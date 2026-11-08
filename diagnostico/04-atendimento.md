# Relatório: atendimento (agente, 08/11/2026)
Testes: sintaxe ok, escopo 4 conhecidos + setCats (fora do escopo), sincronizacao 13/13.

ALTA
1. Transcrição apagada ao "Retomar a escuta" após recarregar/outro aparelho/mescla: textoRef (index.html:8275) nasce com f===VAZIO e nunca é re-semeado quando a ficha chega (5188, 6013); primeiro resultado final sobrescreve transcricao inteira (8300-8301, 8379-8385). 30 min viram uma frase. Conserto: em ligar(), textoRef.current = fRef.current.transcricao.
2. Primeira volta da sincronização sem base: cópia velha do localStorage (vaapty:at:<id>, nunca expira) vence e é ENVIADA (2898-2905 reconciliar sem base → mesclarFicha só preenche vazio; 6008-6016 manda(atual)); o outro aparelho, com local==base, adota o valor velho (2871). KM corrigido ontem no computador volta ao valor antigo quando o celular reabre. Conserto: guardar baseRef no aparelho (vaapty:base:<id>) ou comparar atualizado_em.
3. Descritivo do WhatsApp imprime valor errado com decimal: brlC (2679-2682) faz replace de ponto → "28500.5" (como fichaDoVeiculo entrega, 2737-2739) vira R$ 2.850.050,00. payloadShinkai usa Number() (2912-2916): "51.371" → NaN → null. Conserto: brl(numeroBR(v)).

MÉDIA
4. Ler-antes-de-escrever não é atômico (5985-6016; PUT upsert merge-duplicates sem condição api/atendimento.js:2249-2320): janela GET→PUT apaga o do outro; transcrição recua para o gestor a cada 5 s. Conserto: PATCH condicional por atualizado_em (409 → relê).
5. Cliente corta transcrição em 16.000 pelo COMEÇO (8300) vs servidor 120.000 (2271-2273); o resumo (decisão 39) precisa do começo. Subir o corte ou cortar o meio.
6. Pneu "Médio" volta do banco como "Medio" (cap() em 2740 vs PNEU com acento, 71; option casa por texto 6958): select vazio, gate passa, descritivo "DE: Medio", sync espalha. Mapear enum→rótulo.
7. ChecklistDigital grava o objeto inteiro (9256): último que salva apaga o do outro aparelho — PIX/conta bancária inclusive. Mesmo defeito corrigido no bloco do cliente em 03/11. Base de três pontas ou PATCH por campo.
8. etapaConcluida recebe três listas de fotos diferentes: trilho enviadas (6300/6381), painel do gestor fotosRef.current (5954, inclui erro/aguardando), agenda fotos (5557). Gestor vê PUB ✓ com foto em erro.
9. Autosave manda vazios como null por cima do banco (5712-5714 corpo inteiro; os outros caminhos filtram vazio(), 5789-5791/5456-5458); leitura inicial falha em catch vazio (5245-5247) → 2,5 s depois grava null em chassi/cor/renavam.
10. mesclarAoVivo compara opcionais/indicacoes/shinkaiAvisos como UM campo (2855-2873): dois marcando opcionais diferentes → um perde.
11. despedir() escreve sem ler (5980, 6020, 6033-6039): fechar o celular grava a ficha inteira por cima dos últimos 5 s do computador.
12. Erros engolidos: PATCH da pretensão (5166-5168; a queixa de 03/11), criar veículo ao imprimir (5459-5461 → documento sem conteúdo, o caso MGX1133), storage.set cota cheia (5310).
13. contratoAssinado continua toggle manual (7693, trilho 4890) com atendimento.contrato_assinado_em já conhecido (5133-5139); aceiteFinal idem com termo assinado.

BAIXA
14. Simulador: Math.round(Math.random()*16) (8871) não uniforme — extremos saem com metade da probabilidade; RANDBETWEEN é uniforme. floor(random*17).
15. Cinco regras de leitura de número (numeroBR 8181, numDoc 2961, decimal servidor, brlC, Number) e regex de placa repetida (5452, 5786); vazio() definido 3× com semânticas diferentes (2769, 5456, 5789).
16. semNumeros só em ia/flavia.js: transcrição vai crua para viva e para táticas/resumo (CPF/telefone ditados chegam à Anthropic).
17. CLAUDE.md desatualizado: OBRIG_CLIENTE é só nome+CPF (5489-5491), não nome/CPF/RG/endereço (decisão 7).
18. Checklist: fetch dentro de updater de setCl (9196-9201).
19. key={i} em rodadas (7346) e indicacoes (7993) reordenadas pela sync.

Certo: abrirDocumento antes do await; conteudo gravado; protocolo novo por via; extrairProtocolo casa; numDoc/brlDoc/valorPorExtenso nos casos; consentimento único caminho aceitarELigar; cleanup; OPOSTOS; liberado conta enviadas; Shinkai espera fotos; etapaConcluida×faltaNaEtapa concordam nas 8; chaves do storage com id; fRef; sem componente dentro de componente; REGISTROS_DA_FICHA cobre rodadas/documentos/revisoes; paraColunas aceita tudo que a tela manda.
Paridade: fipeConferida/fipeOficialCodigo/fipeOficialMes/fipeAutenticacao e fipeDesval e shinkaiFotos/shinkaiAvisos vivem só na ficha jsonb (sem coluna); lataria/mecanica têm coluna e não têm campo; negociador sem coluna em veiculo.
