#!/usr/bin/env perl
# Usage: scripts/with-lock.pl <command> [args...]
# Runs the command while holding a lock shared by every worktree of this clone,
# so concurrent heavy checks queue instead of competing for CPU and memory.
# flock is released by the kernel when the holder dies, so a lock never goes stale.
use strict;
use warnings;
use Fcntl qw(:flock O_RDWR O_CREAT);
use Time::HiRes qw(sleep);

die "usage: $0 <command> [args...]\n" unless @ARGV;

chomp(my $common = `git rev-parse --path-format=absolute --git-common-dir`);
die "with-lock: not inside a git repository\n" if $? != 0 || $common eq "";
my $path = "$common/checks.lock";

# A check that calls another locked check would otherwise wait on itself.
exec { $ARGV[0] } @ARGV or die "with-lock: $ARGV[0]: $!\n"
  if ($ENV{WITH_LOCK_HELD} // "") eq $path;

sysopen(my $fh, $path, O_RDWR | O_CREAT) or die "with-lock: $path: $!\n";
my $polls = 0;
until (flock($fh, LOCK_EX | LOCK_NB)) {
  if ($polls % 30 == 0) {
    sysseek($fh, 0, 0);
    sysread($fh, my $holder, 4096);
    $holder = "unknown" unless defined $holder && $holder ne "";
    chomp $holder;
    print STDERR "with-lock: waiting for lock held by pid $holder\n";
  }
  $polls++;
  sleep 0.5;
}
truncate($fh, 0);
sysseek($fh, 0, 0);
syswrite($fh, "$$ (@ARGV)\n");

$ENV{WITH_LOCK_HELD} = $path;
# system() ignores SIGINT in the parent, so Ctrl-C stops the command, then we exit.
system { $ARGV[0] } @ARGV;
exit 127 if $? == -1;
exit 128 + ($? & 127) if $? & 127;
exit $? >> 8;
