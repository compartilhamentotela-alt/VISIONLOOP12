# 📺 VisionLoop

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

- Vídeos aceitos: `.mp4`, `.webm`, `.mkv`, `.mov`, `.avi`
- Imagens aceitas: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
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
- Suporta **quantas TVs quiser** — sem limite.
- Guarde o código de sala: se você recarregar o controlador, um **novo código é gerado** e as TVs precisam ser pareadas de novo.

---

## Hospedagem (Render)

O projeto roda como um Web Service Node.js:

- **Build command**: `npm install`
- **Start command**: `npm start`
- **Porta**: definida automaticamente pela variável de ambiente `PORT` — não é preciso configurar nada.

⚠️ **Atenção ao armazenamento**: o disco do Render é efêmero por padrão. Vídeos, imagens e o arquivo `playlists.json` ficam salvos no disco do servidor e **são apagados a cada novo deploy ou reinício** do serviço. Para que o conteúdo seja permanente, é necessário adicionar um **disco persistente** (Persistent Disk) montado na pasta do projeto, ou migrar o armazenamento de mídia para um serviço externo (S3, Cloudinary, etc.).

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

**Enviei vários arquivos e eles estão subindo um de cada vez**
→ Isso é o comportamento esperado. O envio é sequencial de propósito: subir e converter vários vídeos ao mesmo tempo satura a conexão e o servidor, deixando *todos* os uploads mais lentos e sujeitos a falha. Na fila, cada arquivo termina de verdade antes do próximo começar.

**Meus vídeos sumiram depois de um deploy**
→ Comportamento do disco efêmero do Render (veja a seção **Hospedagem** acima). É preciso configurar um disco persistente ou armazenamento externo.

**A primeira requisição demora muito**
→ No plano gratuito do Render o serviço "dorme" após um período sem uso e leva alguns segundos para acordar na primeira visita.
