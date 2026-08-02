# 📺 VisionLoop

**Versão 0.1.0** — 01/08/2026 · O histórico de mudanças fica em [CHANGELOG.md](CHANGELOG.md).

Sistema web de exibição de vídeos e imagens em loop para TVs, voltado a propagandas, cardápios digitais e apresentações.

## Como funciona

```
[Controlador (PC/celular)] ←→ [Servidor VisionLoop (Render)] ←→ [TV 1]
                                                             ←→ [TV 2]
                                                             ←→ [TV 3...]
```

O servidor é hospedado na web (Render) e serve como intermediário. O controlador e as TVs abrem o **mesmo endereço do site** e se comunicam via WebSocket em tempo real. Como tudo passa pela internet, **as TVs não precisam estar na mesma rede do controlador** — podem estar em lojas, andares ou cidades diferentes.

---

## Requisitos

- Navegador nas TVs (Chrome, Edge ou Firefox) com acesso à internet
- Navegador no dispositivo que vai controlar (PC, notebook ou celular)
- Nenhuma instalação, nenhum IP, nenhuma configuração de rede

---

## Como usar

### 1. Abra o site

Acesse o endereço do VisionLoop no navegador. A tela inicial pergunta como você quer entrar: **Controlador** ou **TV**.

### 2. Abra o Controlador

No seu PC ou celular, acesse o site e escolha **🎮 Controlador**.

O controlador exibe um **código de sala de 5 dígitos** (ex: `48219`). Esse código é o que liga as suas TVs ao seu painel — cada controlador tem o seu, então várias pessoas podem usar o mesmo servidor sem uma enxergar as TVs da outra.

### 3. Conecte as TVs

Em cada TV, abra o navegador, acesse o mesmo endereço do site e escolha **📺 TV**. Digite o **código de sala de 5 dígitos** mostrado no seu controlador e confirme.

A TV aparecerá na lista do controlador em poucos segundos.

### 4. Adicione seus vídeos e imagens

Na aba **"Vídeos"** do controlador, clique na zona de upload ou arraste os arquivos:

- Vídeos aceitos: `.mp4`, `.mov` (formato padrão do iPhone), `.webm`
- Imagens aceitas: `.jpg`, `.jpeg`, `.png`, `.webp`
- Formatos fora dessa lista (`.mkv`, `.avi`, `.gif`, etc.) são recusados no upload. Se precisar usar um arquivo assim, converta para `.mp4` ou `.png` antes de enviar.
- **Todo vídeo enviado é automaticamente convertido para HD (1280x720)** em H.264/AAC otimizado para TV — isso evita travamentos por codec incompatível ou resolução alta demais.
- **Envio em fila (um arquivo por vez)**: se você selecionar ou arrastar vários arquivos de uma só vez, eles **não** sobem todos juntos. O controlador monta uma fila e envia um de cada vez — o próximo só começa quando o anterior termina de subir e de ser convertido no servidor. Isso evita saturar a conexão e sobrecarregar o servidor com várias conversões simultâneas. A barra de progresso de cada arquivo aparece na lista; os que ainda estão na fila aguardam a vez.

### 5. Reproduza

Selecione uma TV na lista, escolha um vídeo ou imagem e mande reproduzir — ou monte uma playlist na aba **"Playlists"** e inicie a playlist na TV escolhida.

---

## Funcionalidades

| Função | Descrição |
|--------|-----------|
| ▶ Reproduzir | Envia um vídeo ou imagem para a TV selecionada |
| ⏸ Pausar / ▶ Retomar | Pausa e retoma a reprodução na TV |
| ⏹ Parar | Para a reprodução e volta à tela de espera |
| 📡 Transmitir para todas | Envia o mesmo conteúdo para todas as suas TVs ao mesmo tempo |
| 🎬 Playlists | Sequências de vídeos e imagens, com tempo configurável por imagem (1 a 300s) |
| 🔒 Código de sala | Cada controlador só enxerga e comanda as TVs pareadas com o seu código de 5 dígitos |
| ⛶ Tela cheia | Coloca a TV em tela cheia remotamente, pelo controlador |
| Loop automático | O conteúdo fica em loop infinito até você mandar parar |
| Nome da TV | Cada TV pode ter um nome personalizado |

---

## Dicas

- Para **tela cheia** na TV, use o botão de tela cheia do próprio controlador, ou pressione F11 no navegador da TV.
- O sistema **reconecta automaticamente** se a conexão cair, tanto no controlador quanto nas TVs.
- Cada TV **lembra do pareamento e do que estava tocando**. Se ela for desligada da tomada ou reiniciar, volta a exibir sozinha ao ligar — ninguém precisa ir até lá digitar o código de novo.
- Suporta **quantas TVs quiser** — sem limite.
- O controlador **mantém o mesmo código de sala** mesmo que você recarregue ou feche e reabra a página, então as TVs já pareadas continuam conectadas.
- Cada TV mostra na tela de espera a qual código está pareada, e tem um botão **"Trocar código"** caso você precise apontá-la para outro controlador.

---

## TVs antigas: modo compatibilidade

Para trocar de vídeo sem tela preta, o VisionLoop prepara o próximo vídeo em segundo plano nos últimos segundos do vídeo atual. Isso exige que a TV consiga manter dois vídeos carregados por alguns instantes — e algumas Smart TVs de entrada têm um único decodificador de vídeo por hardware.

Se uma TV específica travar, piscar ou ficar com a tela preta na troca de vídeos, marque **"Modo compatibilidade"** na tela dela (a caixinha aparece tanto na tela do código quanto na tela de espera). A TV passa a carregar um vídeo por vez: a troca fica um pouco menos suave, mas o risco de travamento cai bastante. A escolha vale só para aquela TV e fica salva nela.

Também dá para deixar isso fixo no endereço, útil quando a TV abre o site sozinha ao ligar:

```
https://SEU-ENDERECO/tv.html?compat=1
```

Se uma TV travar três vezes em dois minutos, ela se recarrega sozinha e volta a exibir o mesmo conteúdo, sem precisar de intervenção.

---

## Hospedagem (Render)

O projeto roda como um Web Service Node.js:

- **Build command**: `npm install`
- **Start command**: `npm start`
- **Porta**: definida automaticamente pela variável de ambiente `PORT` — não é preciso configurar nada.

⚠️ **Atenção ao armazenamento e à banda**: o disco do Render é efêmero por padrão — vídeos, imagens e `playlists.json` **são apagados a cada novo deploy ou reinício**. E o plano gratuito do Render inclui só **5GB de banda de saída por mês** no total, o que uma única TV tocando vídeo o dia todo já consome sozinha em poucas horas. Os dois problemas têm a mesma solução: guardar e servir os vídeos/imagens de um armazenamento externo em vez do disco do Render (ver seção seguinte).

---

## Armazenamento externo (Cloudflare R2) — opcional, recomendado para produção

Por padrão o servidor guarda tudo no próprio disco (comportamento de sempre). Configurando as variáveis de ambiente abaixo no Render, ele passa a **enviar cada vídeo/imagem já processado para um bucket Cloudflare R2**, e as TVs passam a buscar o arquivo direto de lá em vez do Render. Isso resolve ao mesmo tempo o disco efêmero (o R2 persiste entre deploys) e o teto de banda (baixar do R2 não é cobrado).

**Como configurar:**

1. Crie uma conta gratuita em [cloudflare.com](https://cloudflare.com), se ainda não tiver.
2. No painel, vá em **R2 Object Storage** e crie um bucket (ex: `visionloop-videos`).
3. Ative o acesso público do bucket. A Cloudflare avisa que a URL de teste automática (`*.r2.dev`) **é limitada e não deve ser usada em produção** — para TVs ligadas o dia todo, o certo é conectar um domínio próprio (ex: `videos.seudominio.com`) ao bucket. A URL de teste serve para validar a configuração antes disso.
4. Em **Manage API tokens**, crie um token com permissão de leitura e escrita para esse bucket. Isso dá um **Access Key ID**, um **Secret Access Key** e o **endpoint** da conta (`https://<ID-da-conta>.r2.cloudflarestorage.com`).
5. No painel do Render, na aba **Environment** do serviço, cadastre estas 5 variáveis (nunca no código, nunca compartilhadas fora do Render):
   - `R2_ENDPOINT` — o endpoint do passo 4.
   - `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` — as chaves do passo 4.
   - `R2_BUCKET_NAME` — o nome do bucket do passo 2.
   - `R2_PUBLIC_BASE_URL` — a URL pública do passo 3 (dev ou domínio próprio), sem barra no final.

Com as 5 variáveis presentes, o próximo deploy já passa a usar o R2 automaticamente — nada muda na tela do controlador nem da TV. **Atenção**: vídeos que já estavam só no disco local do Render antes de ligar o R2 não são migrados sozinhos; suba-os de novo pelo controlador se ainda precisar deles.

### Evitando cobrança surpresa (`R2_MAX_STORAGE_GB`)

A Cloudflare não tem um limite rígido de uso para o R2 — só um alerta por e-mail que avisa *depois* que você já passou da faixa grátis, sem impedir a cobrança. Por isso o VisionLoop tem sua própria trava, opcional: configure a variável de ambiente **`R2_MAX_STORAGE_GB`** (ex: `9.5`) e o servidor passa a **recusar novos uploads** assim que o total guardado no bucket chegasse perto desse valor, com um aviso claro na tela do controlador — nunca deixando passar do limite que você definiu. Sem essa variável, não existe teto (fica só por sua conta acompanhar o uso no painel da Cloudflare).

---

## Solução de problemas

**TV não aparece no controlador**
→ Confirme que a TV digitou o **mesmo código de sala de 5 dígitos** que aparece no controlador.
→ Se o controlador foi recarregado, o código mudou — pareie a TV novamente com o código novo.
→ Verifique se a TV está com acesso à internet.

**Vídeo não toca na TV**
→ Envie o vídeo pelo controlador (o upload converte automaticamente para um formato compatível com TVs).
→ Navegadores de Smart TV muito antigos podem não suportar WebSocket ou vídeo HTML5 — nesse caso, um dispositivo externo (Chromecast, Fire Stick, mini PC) resolve.

**Vídeo trava e não volta mais**
→ Todo upload feito pelo controlador é convertido para HD (1280x720, H.264 Main + AAC + faststart), o que resolve a maioria dos travamentos causados por codec incompatível, resolução alta demais ou vídeos sem o índice no início do arquivo.
→ A TV também detecta sozinha quando um vídeo "congela" (sem erro explícito) e pula para o próximo automaticamente.

**Aparece um vídeo com nome estranho, terminado em `(1)`**
→ Era um bug: como o vídeo convertido era salvo enquanto o arquivo original ainda estava no disco, o sistema achava que havia um conflito de nome e adicionava ` (1)` em **todo** upload `.mp4`. Corrigido — agora o vídeo convertido substitui o original e mantém o nome que você enviou.
→ O sufixo ` (1)` ainda aparece (corretamente) quando você envia um arquivo com um nome que **já existe** na biblioteca. Nesse caso os dois são mantidos, e nenhum arquivo é sobrescrito.

**Apareceu um arquivo `.transcoding_...` na lista de vídeos**
→ É o arquivo temporário da conversão. Ele agora fica oculto da lista enquanto o vídeo é processado, e sobras de conversões interrompidas (queda ou reinício do servidor durante um upload) são apagadas automaticamente na inicialização.

**Erro 404 de `/favicon.ico` no console do navegador**
→ Era só o ícone do site faltando; não afetava a reprodução. O servidor agora responde `/favicon.ico` com o ícone do app, e as páginas declaram o ícone diretamente.

**Enviei vários arquivos e eles estão subindo um de cada vez**
→ Isso é o comportamento esperado. O envio é sequencial de propósito: subir e converter vários vídeos ao mesmo tempo satura a conexão e o servidor, deixando *todos* os uploads mais lentos e sujeitos a falha. Na fila, cada arquivo termina de verdade antes do próximo começar.

**Meus vídeos sumiram depois de um deploy**
→ Comportamento do disco efêmero do Render (veja a seção **Hospedagem** acima). Configure o armazenamento no Cloudflare R2 (seção **Armazenamento externo** acima) para que o conteúdo sobreviva a deploys.

**Depois de configurar o R2, meus vídeos antigos sumiram da lista**
→ Esperado. Os vídeos que estavam só no disco local do Render não são migrados automaticamente para o R2 — suba-os de novo pelo controlador.

**A primeira requisição demora muito**
→ No plano gratuito do Render o serviço "dorme" após um período sem uso e leva alguns segundos para acordar na primeira visita.

**Upload de vídeo dá erro 502 (Bad Gateway)**
→ No plano gratuito do Render (512MB de RAM), converter o vídeo consome memória suficiente para estourar o limite do plano — o Render mata e reinicia o app no meio do upload, e o navegador só vê a conexão cair. Isso pode acontecer mesmo com vídeos pequenos, porque o estouro é por overhead do processo de conversão, não só pelo tamanho do arquivo. A partir da 0.0.9-fix3 a conversão usa bem menos memória, o que resolve a maioria dos casos — mas se continuar acontecendo, confira os **Logs** do serviço no painel do Render por volta do horário do erro (procure por "out of memory" ou "exit code 137"); se for isso, a solução definitiva é subir para um plano com mais memória (Starter ou superior).
