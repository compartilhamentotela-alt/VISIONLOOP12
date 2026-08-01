# Changelog

Todas as mudanças relevantes do VisionLoop, da versão mais recente para a mais antiga.

## Como versionar

O padrão de nome é **`AAAA-MM-DD_VisionLoop-X.Y.Z`**, usado igual na pasta e no zip — por exemplo `2026-07-31_VisionLoop-0.0.8.zip`. O campo `"version"` do `package.json` recebe só o número (`0.0.8`) e deve bater sempre com o do nome.

A data vai no formato ano-mês-dia justamente porque assim a ordem alfabética e a cronológica são a mesma coisa: a pasta se organiza sozinha, da versão mais antiga para a mais nova, sem depender de datas de modificação (que se perdem ao copiar ou descompactar arquivos). Escrita como dia-mês-ano isso não funcionaria.

Sobre qual número mexer: suba o último em correções e ajustes, o do meio quando entrar funcionalidade nova, e o primeiro só se algo quebrar a compatibilidade com o que já existia. O "o que mudou" fica aqui neste arquivo, nunca no nome do zip.

---

## 0.0.9-fix2 — 01/08/2026

Correção urgente: **a TV não conseguia mais ser pareada com o controlador**. Regressão introduzida pela 0.0.9.

### O que estava acontecendo

O servidor sorteia um código de sala novo toda vez que o controlador se conecta. Ou seja, **recarregar a página do controlador sempre gerou um código diferente e deixou as TVs órfãs** — isso é anterior à 0.0.9 e estava até documentado no README como "as TVs precisam ser pareadas de novo".

O que a 0.0.9 fez foi transformar esse incômodo num beco sem saída: a retomada automática passou a reconectar a TV com o código guardado e a **pular a tela de digitação**. Com o controlador já usando outro código, a TV ficava presa a um código morto, invisível para o controlador e sem nenhuma forma de digitar o código novo.

### Corrigido

- **O controlador mantém o mesmo código de sala entre recargas.** O código passou a ser guardado no navegador do controlador e reenviado ao conectar; o servidor o devolve se ninguém mais estiver usando. Recarregar o controlador — ou reabrir a aba — não desemparelha mais nenhuma TV. Isso resolve a causa raiz, que existia desde antes da 0.0.9.
- **A TV ganhou o botão "Trocar código"**, sempre visível na tela de espera, que esquece o pareamento e volta para a tela de digitação. É a saída garantida para qualquer situação em que o código mude.
- **A TV mostra a que controlador está pareada** e se ele está no ar. Antes não havia como distinguir "sem controlador" de "controlador com outro código" — a tela simplesmente ficava parada.
- Se dois controladores forem abertos ao mesmo tempo, o segundo avisa que o código salvo já está em uso e explica o que fazer, em vez de trocar de código silenciosamente.

### Verificação

Testado de ponta a ponta com controlador e TV em abas separadas, com WebSocket real: parear, recarregar o controlador (código mantido, TV continua na lista), recarregar a TV (volta sozinha e segue pareada), usar o "Trocar código" e parear de novo. Também conferido que o fluxo principal segue intacto — enviar vídeo e pausar pelo controlador chegam na TV — e que a TV passa a indicar quando o controlador é fechado.

---

## 0.0.9-fix — 01/08/2026

Correção do tempo de exibição das imagens na playlist.

### Corrigido

- **O tempo definido para uma imagem sempre voltava para 10 segundos.** No campo de tempo da playlist, o nome do arquivo era interpolado dentro do atributo `onchange` do HTML e havia uma aspa fora de lugar: em vez de `updatePlItemDuration('Banner.png', this.value)`, o navegador recebia `updatePlItemDuration('Banner.png'`. O atributo terminava ali, o resto virava lixo, e o handler não compilava — o console acusava `SyntaxError: missing ) after argument list` a cada digitação. Como a função nunca executava, o valor digitado era descartado e a playlist salvava sempre o padrão de 10 segundos.

  A correção não foi apenas fechar o parêntese: o campo passa a mandar o **índice** do item, que é um número e não precisa de escape, em vez do nome do arquivo. Isso elimina de vez essa classe de erro, inclusive o caso de um nome de arquivo com aspas quebrar o atributo.

- O campo passou a atualizar durante a digitação (`oninput`) e não só ao sair dele, evitando perder o valor de quem digita e clica direto em Salvar.
- O valor agora é limitado a 1–300 segundos também no código. Antes o `min`/`max` do campo era só visual: um valor fora da faixa seguia adiante.
- **O servidor passou a validar o tempo em vez de confiar no que chega.** Tempo ausente, negativo, absurdo ou não numérico é corrigido antes de gravar — sem isso, uma requisição malformada podia deixar uma imagem parada na tela indefinidamente. Itens sem nome válido são descartados e o nome passa por `path.basename()`.
- Imagem salva sem tempo (playlist antiga) agora aparece com o tempo padrão em vez de "0s".
- Os valores 10, 1 e 300, espalhados pelo código, viraram constantes únicas no controlador e no servidor.

### Verificação

Reproduzido e comparado nas duas versões com um navegador de verdade: na anterior, digitar 25s e 7s em duas imagens gravava `10s` e `10s` e lançava o `SyntaxError`; nesta, grava `25s` e `7s` sem nenhum erro de JavaScript. Também foram testados o ciclo de reedição (reabrir a playlist mostra os tempos certos e permite alterá-los), os limites do servidor (99999 → 300, −5 → 1, texto → padrão) e o comportamento final na TV, que exibiu cada imagem exatamente pelo tempo configurado.

---

## 0.0.9 — 31/07/2026

Versão focada em **não travar em TV nenhuma**. O preload continua existindo, mas deixou de manter dois vídeos carregados o tempo todo — que era justamente o maior risco em TVs de entrada.

### O problema

Muitas Smart TVs, principalmente as de entrada e as mais antigas, têm **um único decodificador H.264 por hardware**. Até a 0.0.8 os dois elementos de vídeo ficavam carregados durante toda a reprodução, disputando esse recurso. Quando o segundo não conseguia um decodificador, o resultado variava entre falhar em silêncio, cair para decodificação por software (que engasga numa CPU de TV) ou fazer o vídeo que estava tocando congelar — exatamente o que o preload pretendia evitar.

### Alterado

- **Preload tardio.** O próximo item passa a ser carregado cerca de 8 segundos antes do fim do atual, em vez de logo no início dele. A janela em que dois decodificadores são disputados caiu do vídeo inteiro para poucos segundos.
- **Liberação imediata do player que sai de cena.** Antes o elemento antigo segurava decodificador e memória até a troca seguinte; agora o `src` é removido na hora. Fora da janela de preload, apenas um vídeo fica carregado.
- **Nenhum decodificador preso durante imagens.** Enquanto uma imagem está na tela, os dois elementos de vídeo são liberados.
- **Conversão mais conservadora**: nível H.264 baixado de 4.0 para **3.1** (o exato necessário para 720p30 — o 4.0 sinalizava exigências de 1080p, e decodificadores antigos que checam esse campo podiam recusar o arquivo); teto de bitrate de **3 Mbps** com `maxrate`/`bufsize`, porque picos de bitrate travam mais TVs do que média alta; e keyframe a cada 2 segundos, o que acelera a recuperação depois de um engasgo.

### Adicionado

- **Modo compatibilidade**, por TV. Uma caixinha nas telas de pareamento e de espera desliga o pré-carregamento duplo e usa um único elemento de vídeo. É a saída para uma TV específica que continue engasgando, sem precisar de nova versão. A escolha fica salva na própria TV, e o endereço aceita `?compat=1` para já abrir nesse modo.
- **Recuperação de emergência.** Se a TV travar três vezes em dois minutos, a página se recarrega sozinha. Um único arquivo com problema no meio de uma playlist saudável não dispara isso: o contador zera sempre que um item reproduz normalmente por 10 segundos, e erro de formato — que recarregar não resolveria — não conta.
- **Retomada automática.** A TV guarda localmente o código de pareamento, o nome e o que estava tocando, e volta ao ar sozinha depois de um reload, seja o de emergência, seja uma queda de energia. Ninguém precisa ir até a TV digitar o código de novo.

### Corrigido

- Playlist com um único item recarregava o mesmo vídeo a cada volta, em vez de repetir o que já estava na memória.

---

## 0.0.8 — 31/07/2026

Versão de limpeza: o app deixou de ser um sistema de rede local e passou a assumir de vez que roda na web (Render). Junto vieram correções de bugs de upload e o enxugamento dos formatos aceitos.

### Formatos aceitos

- **Vídeo**: `.mp4`, `.mov` (formato padrão do iPhone) e `.webm`.
- **Imagem**: `.jpg`/`.jpeg`, `.png` e `.webp`.
- Removidos `.mkv`, `.avi` e `.gif` — formatos pouco usados neste cenário. O upload agora os recusa com "Formato não suportado".
- Arquivos desses formatos que já estejam na pasta `videos/` do servidor continuam sendo listados e reproduzidos; só o envio de novos está bloqueado.

### Corrigido

- **Todo upload `.mp4` ganhava ` (1)` no nome.** Depois da conversão, o nome final era calculado enquanto o arquivo original ainda estava no disco. Como para um `.mp4` o nome desejado era idêntico ao do original, o sistema enxergava uma colisão do arquivo consigo mesmo e renomeava para `Nome (1).mp4`. Uploads de outras extensões não sofriam, porque a extensão mudava para `.mp4` no caminho. Agora o arquivo convertido substitui o original e o nome enviado é preservado. Colisão real com um arquivo já existente continua gerando ` (1)`, sem sobrescrever nada.
- **Arquivo temporário aparecia na biblioteca.** Os temporários `.transcoding_*.mp4` criados durante a conversão podiam surgir na grade do controlador com nome estranho. Agora ficam ocultos.
- **Sobras de conversões interrompidas.** Se o servidor caísse ou reiniciasse no meio de um upload, o temporário ficava no disco para sempre. Agora são apagados na inicialização.
- **Erro 404 de `/favicon.ico` no console.** Adicionada a rota servindo o ícone do app, e as páginas passaram a declarar o ícone.
- **Aviso `Allow attribute will take precedence over 'allowfullscreen'`.** O iframe da tela inicial declarava os dois atributos equivalentes; ficou só o `allowfullscreen`, que funciona tanto em navegador moderno quanto nos navegadores antigos de Smart TV.
- **Falha que derrubava o servidor.** Um acesso a arquivo com extensão fora da tabela de tipos MIME lançava erro não tratado e encerrava o processo — cenário que a própria remoção de formatos tornava possível.

### Alterado

- **Uploads múltiplos agora são sequenciais.** Ao selecionar ou arrastar vários arquivos, eles entram numa fila e sobem um de cada vez; o próximo só começa quando o anterior termina de enviar e de ser convertido. Antes todos subiam em paralelo, saturando a conexão e o servidor.
- **Removido tudo que era específico de rede local**: o endpoint que descobria o IP da máquina, a varredura de porta livre (a porta agora vem sempre da variável de ambiente `PORT`, definida pelo Render) e o endereço de fallback `localhost:3000` na conexão em tempo real.
- A mensagem "nenhuma TV conectada" passou a explicar o fluxo real (abrir o site na TV e digitar o código de sala) em vez de mandar abrir um arquivo.
- `README.md` reescrito para o cenário web, com seção de hospedagem no Render e solução de problemas atualizada.

### Removido

- `NOVAS_FUNCIONALIDADES.md` — documentação obsoleta, não lida pelo app; o conteúdo relevante está no README e o histórico, aqui.
- `videos/Video-Teste1.mp4` e `videos/Video-Teste2.mp4` — vídeos de exemplo que apareciam na grade como se fossem conteúdo do usuário. O pacote caiu de ~12 MB para ~291 KB.

### Interno

- As constantes de formato foram unificadas: nove cópias da mesma verificação de imagem no controlador viraram uma constante única, o que evita que uma mudança de formato fique pela metade no futuro.

---

## Versões anteriores

Reconstruído a partir da documentação que acompanhava os pacotes; pode não estar completo.

### 0.0.7 — junho/2026

- Suporte a imagens além de vídeos, com tempo de exibição configurável por imagem (1 a 300 segundos, padrão 10).
- Playlists mistas, combinando vídeos e imagens na mesma sequência; vídeos tocam até o fim, imagens respeitam o tempo configurado.
- Conversão automática de todo vídeo enviado para HD (1280x720, H.264 Main + AAC, com o índice no início do arquivo), resolvendo travamentos causados por codec incompatível, resolução alta demais ou arquivos sem índice.
- Detecção de vídeo "congelado" na TV, sem erro explícito, com pulo automático para o próximo item.
- Pareamento por código de sala de 5 dígitos: cada controlador só enxerga e comanda as TVs pareadas com ele.

### 0.0.6

Versão base: controle de vídeos em loop para TVs, com reprodução, pausa, retomada, parada e transmissão simultânea para todas as TVs.
