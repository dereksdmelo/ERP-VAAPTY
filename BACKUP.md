# Backup

Toda noite, às 3h, `.github/workflows/backup.yml` copia o sistema para o
Google Drive pessoal do Derek, na pasta **Vaapty-backup**, criptografado.

| o quê | onde | quanto tempo |
|-------|------|--------------|
| banco (tudo do ERP, os logins, o registro dos arquivos) | `banco/AAAA-MM-DD.dump` | 35 dias, e o do dia 1º de cada mês para sempre |
| arquivos (fotos, CNH, CRLV, contratos, mídia do WhatsApp) | `arquivos/<bucket>/…` | para sempre — o que se apaga no sistema continua aqui |
| recibo | `ULTIMO-BACKUP.txt` | o último que deu certo |

Além disso o Supabase guarda sozinho 7 dias do banco (Database → Backups),
mas no mesmo lugar que o sistema e **sem os arquivos**.

**No Drive, tudo aparece com nome embaralhado.** É a criptografia: sem a
senha (`BACKUP_SENHA`, no gerenciador de senhas do Derek) nada ali se lê.
**Perdeu a senha, perdeu o backup.**

**Falhou, o GitHub manda e-mail** para o Derek. Para conferir à mão:
GitHub → Actions → "Backup para o Google Drive". Para rodar agora: o mesmo
lugar → "Run workflow".

## Restaurar

Num computador com o [rclone](https://rclone.org/downloads/) e o
`pg_restore` (PostgreSQL 17):

```bash
rclone config
```

Crie dois remotes: `gdrive` (tipo **drive**, entrando com a conta Google do
Derek) e `cofre` (tipo **crypt**, remote `gdrive:Vaapty-backup`, nomes de
arquivo `standard`, diretórios cifrados `true`, e a senha do backup; deixe
o segundo "salt" vazio).

```bash
rclone ls cofre:banco
```

```bash
rclone copy cofre:banco/2026-11-18.dump .
```

```bash
rclone copy cofre:arquivos ./arquivos
```

O banco volta com `pg_restore` num projeto Supabase novo (ou noutro
Postgres). Para ver o que tem dentro sem restaurar nada:

```bash
pg_restore --list 2026-11-18.dump
```

Para trazer só os dados do ERP para um projeto novo, depois de rodar as
migrações de `supabase/migrations/`:

```bash
pg_restore --data-only --no-owner -n public -d "URL_DO_BANCO_NOVO" 2026-11-18.dump
```

Os arquivos voltam para o Storage com `rclone copy ./arquivos/<bucket> supa:<bucket>`
(remote `supa` do tipo s3, como no `backup.yml`).
