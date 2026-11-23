// 经 SSH 把一个压缩包传到服务器：解到 REMOTE_DIR/releases/<版本>-<秒>-<进程号>/，核对 version.txt，再原子地把软链接 current 换过去，
// 最后清掉多余的旧发布。切换之前任何一步失败都不动 current，线上还是旧版本；切换以后清旧发布失败只警告、照样算成功。
// 照 Wellyard 官网（同一台服务器上的另一个站）的那份写的，改了注释和报错里指的文档。
// 只用 Node 自带模块和系统的 ssh：回滚时部署命令在临时检出里跑。
// 服务器上要事先（用 root）建好 REMOTE_DIR，属主是部署用户；IP、端口、用户名写在主仓库的清单里，不写在这里（这个仓库是公开的）。
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// underTmp(path) -> path 在系统临时目录下面
const underTmp = (path) => {
  const t = resolve(tmpdir());
  const p = resolve(path);
  return p.startsWith(t + sep) && p !== t;
};

// sshEnv(env) -> { target, port, key, remoteDir, fake }；缺变量、写法不对都抛错并点名变量。
// DEPLOY_SSH_FAKE 是测试专用的替身 ssh：它会从继承的环境生效，所以只认系统临时目录下的文件，本机残留别的值时直接报错
export function sshEnv(env) {
  const missing = ['SSH_TARGET', 'SSH_PORT', 'SSH_KEY', 'REMOTE_DIR'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`缺环境变量：${missing.join('、')}（应由 wellyard deploy 和清单里的部署目标传进来）`);
  if (!/^[a-z_][a-z0-9_-]*@[A-Za-z0-9.-]+$/.test(env.SSH_TARGET)) {
    throw new Error('SSH_TARGET 要写成「用户@主机」（比如 deploy@example.com）：核对清单里的部署目标');
  }
  if (!/^\d{1,5}$/.test(env.SSH_PORT)) throw new Error('SSH_PORT 要是端口号（1 到 5 位数字）：核对清单里的部署目标');
  const dir = env.REMOTE_DIR;
  const segs = dir.split('/').slice(1);
  if (!/^\/[A-Za-z0-9._/-]+$/.test(dir) || segs.length < 2 || segs.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('REMOTE_DIR 要是服务器上的绝对路径：至少两段、不以 / 结尾、不带 . 和 .. 段、只用字母数字和 ._-（比如 /var/www/site）：核对清单里的部署目标');
  }
  const key = env.SSH_KEY.startsWith('~/') ? join(homedir(), env.SSH_KEY.slice(2)) : env.SSH_KEY;
  if (!existsSync(key)) throw new Error(`找不到部署密钥 ${key}（SSH_KEY）：先照主仓库 CLAUDE.md 生成，或者从别的电脑拷过来`);
  let fake = null;
  if (env.DEPLOY_SSH_FAKE) {
    // wellyard 运行部署命令时一定设 WELLYARD_DEPLOY_ID，测试不设：两个同时有，就是真部署的环境里残留了替身
    if (env.WELLYARD_DEPLOY_ID || !underTmp(env.DEPLOY_SSH_FAKE)) {
      throw new Error('DEPLOY_SSH_FAKE 只给测试用（只认系统临时目录下的替身，wellyard 部署时不认）：正式部署前把它从环境里去掉');
    }
    fake = env.DEPLOY_SSH_FAKE;
  }
  return { target: env.SSH_TARGET, port: env.SSH_PORT, key, remoteDir: dir, fake };
}

// remoteScript({ remoteDir, version, commit, gzip, keep }) -> 在服务器上跑的 POSIX sh 脚本，压缩包从标准输入来。
// 脚本经命令行参数传过去，Windows 上非 ASCII 字符可能被转坏，所以只写 ASCII；给人看的说明由 upload 按退出码在本地写：
// 3 = REMOTE_DIR 不存在，5 = 里面有不是部署留下的东西（防 REMOTE_DIR 写错指到别的站点），4 = version.txt 和这次的提交对不上。
// 发布目录名带时间戳和进程号：deploy 在失败、作废后会复用版本号，同一个版本号再部署一次也是新目录，不会盖掉正在线上的那个。
// 清旧发布按目录的修改时间排（解开的目录时间是打包时的，回滚时很旧，所以解完 touch 成部署时刻），
// current 指着的那个永远不删，加上它一共留 keep 个。两台机器时钟差一点时 tar 不刷警告。
export function remoteScript({ remoteDir, version, commit, gzip, keep = 3 }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(version)) throw new Error(`版本号写法不对：${version}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`提交号要是 40 位十六进制：${commit}`);
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`keep 要是正整数：${keep}`);
  return [
    'set -eu',
    'umask 022',
    `D='${remoteDir}'`,
    `C='${commit}'`,
    `KEEP=${keep}`,
    '[ -d "$D" ] || exit 3',
    'for f in "$D"/* "$D"/.[!.]* "$D"/..?*; do',
    '  [ -e "$f" ] || [ -L "$f" ] || continue',
    '  case "${f##*/}" in releases|current|current.tmp) ;; *) echo "foreign: ${f##*/}" >&2; exit 5;; esac',
    'done',
    `N='${version}'-$(date +%s)-$$`,
    'P="$D/releases/$N.partial"',
    'mkdir -p "$D/releases"',
    'rm -rf "$P"',
    'mkdir "$P"',
    `tar --warning=no-unknown-keyword --warning=no-timestamp ${gzip ? '-xzf' : '-xf'} - -C "$P"`,
    '[ "$(cat "$P/version.txt" 2>/dev/null)" = "$C" ] || { rm -rf "$P"; exit 4; }',
    'mv "$P" "$D/releases/$N"',
    'touch "$D/releases/$N"',
    'ln -sfn "releases/$N" "$D/current.tmp"',
    'mv -Tf "$D/current.tmp" "$D/current"',
    'echo "switched to releases/$N"',
    // 切换以后 current 已经是新版：清旧发布失败只警告、照样以 0 退出，不然部署记录会和线上对不上
    'set +e',
    'CUR=$(readlink "$D/current")',
    'i=0',
    'for r in $(ls -1t "$D/releases"); do',
    '  case "$r" in *.partial) rm -rf "$D/releases/$r" || echo "warning: could not remove releases/$r" >&2; continue;; esac',
    '  [ "releases/$r" = "$CUR" ] && continue',
    '  i=$((i+1))',
    '  [ "$i" -lt "$KEEP" ] || rm -rf "$D/releases/$r" || echo "warning: could not remove releases/$r" >&2',
    'done',
    'exit 0',
  ].join('\n');
}

// upload(archivePath, cfg, { version, commit, gzip, env })：一条 ssh 把 archivePath 当标准输入传过去、跑 remoteScript；失败就抛错。
// 不自动信任没见过的主机密钥（StrictHostKeyChecking=yes），不弹密码（BatchMode=yes）。远端的输出写到 stderr
export function upload(archivePath, cfg, { version, commit, gzip, env = process.env }) {
  const script = remoteScript({ remoteDir: cfg.remoteDir, version, commit, gzip });
  const args = [
    '-i', cfg.key, '-p', cfg.port,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15',
    cfg.target, script,
  ];
  const [cmd, argv] = cfg.fake ? [process.execPath, [cfg.fake, ...args]] : ['ssh', args];
  const fd = openSync(archivePath, 'r');
  let r;
  try {
    r = spawnSync(cmd, argv, { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  } finally {
    closeSync(fd);
  }
  if (r.error) throw new Error(`运行 ssh 失败：${r.error.message}`);
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const tail = out ? `\n${out}` : '';
  if (r.status === 255) {
    throw new Error(`传到服务器失败：连不上服务器、这台电脑没核对过它的主机密钥（先手动 ssh 一次核对指纹），或者部署公钥还没加到服务器上；要是传完才断的，可能已经切换了，查一下线上的 version.txt${tail}`);
  }
  if (r.status === 3) throw new Error(`传到服务器失败：服务器上没有 ${cfg.remoteDir}，先照主仓库 CLAUDE.md 用 root 建好${tail}`);
  if (r.status === 5) throw new Error(`传到服务器失败：${cfg.remoteDir} 里有不是部署留下的东西，不像这个站点的发布目录，没有动它：核对 REMOTE_DIR${tail}`);
  if (r.status === 4) throw new Error(`传到服务器失败：解开的 version.txt 和这次的提交对不上，没有切换${tail}`);
  if (r.status !== 0) throw new Error(`传到服务器失败（退出码 ${r.status}）${tail}`);
  if (out) process.stderr.write(`${out}\n`);
}
